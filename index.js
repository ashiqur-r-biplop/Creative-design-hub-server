require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// middleware
app.use(cors());
app.use(express.json());
const username = process.env.USER_NAME;
const password = process.env.PASSWORD;

const uri = `mongodb+srv://${username}:${password}@cluster0.klmvqmu.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  // console.log(authorization);
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }

  const token = authorization.split(" ")[1];
  // console.log(token);
  jwt.verify(token, process.env.ACCESS_SECRET_TOKEN, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access2" });
    }

    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    const userCollection = client.db("CreativaDesign").collection("users");
    const commentCollection = client.db("CreativaDesign").collection("comment");
    const classCollection = client.db("CreativaDesign").collection("classes");
    const selectedClassCollection = client
      .db("CreativaDesign")
      .collection("selectedClass");

    app.get("/overView", async (req, res) => {
      const activeUser = await userCollection.find().toArray();
      const Review = await commentCollection.estimatedDocumentCount();
      const AllClasses = await classCollection.find().toArray();
      const activeStudent = AllClasses.reduce(
        (sum, classes) => sum + classes.enrollStudent,
        0
      );
      const Revenue = AllClasses.reduce(
        (sum, classes) => sum + (classes.enrollStudent * classes.price),
        0
      );
      res.send({
        activeUser: activeUser.length,
        Review: Review,
        activeStudent: activeStudent,
        Revenue,
      });
    });

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const price = req.body.price;

      if (price) {
        const amount = parseFloat(price) * 100;
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      }
    });

    app.post("/jwt", (req, res) => {
      const user = req.body;
      // console.log(user);
      const token = jwt.sign(user, process.env.ACCESS_SECRET_TOKEN, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      // console.log(email);
      const query = { email: email };
      // console.log(query);
      const user = await userCollection.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden message" });
      }
      next();
    };
    // student
    const verifyStudent = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      // console.log(query);
      const user = await userCollection.findOne(query);
      // console.log(user);
      if (user?.role !== "student") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden message" });
      }
      next();
    };
    // instructor
    const verifyInstructor = async (req, res, next) => {
      const email = req.decoded;
      // console.log(email);
      const query = { email: email.email };
      // console.log(query, "email");
      const user = await userCollection.findOne(query);
      // console.log(user);
      if (user?.role !== "instructor") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden message" });
      }
      next();
    };

    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      // console.log(email);
      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });
    app.get("/users/student/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      // console.log(email);
      if (req.decoded.email !== email) {
        res.send({ student: false });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { student: user?.role === "student" };
      res.send(result);
    });
    app.get("/users/instructor/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        res.send({ instructor: false });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { instructor: user?.role === "instructor" };
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      // console.log(user);
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists" });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    app.post("/selected", verifyJWT, verifyStudent, async (req, res) => {
      const selectedClass = req.body;
      const result = await selectedClassCollection.insertOne(selectedClass);
      res.send(result);
    });
    app.get("/getSelectedClass/:email", async (req, res) => {
      const query = req.params.email;
      // console.log(query);
      const filter = { studentEmail: query };
      // console.log(filter);
      const result = await selectedClassCollection.find(filter).toArray();
      res.send(result);
    });
    app.patch(
      "/postPayAmount/:id",
      verifyJWT,
      verifyStudent,
      async (req, res) => {
        const id = req.params.id;
        // console.log(id);
        const body = req.body;
        // console.log(body);
        const query = { _id: new ObjectId(id) };
        const options = { upsert: true };
        const paidClass = {
          $set: {
            className: body?.className,
            enrollStudent: body?.enrollStudent + 1,
            imgURL: body?.imgURL,
            price: body?.price,
            instructorEmail: body?.instructorEmail,
            instructorName: body?.instructorName,
            studentEmail: body?.studentEmail,
            state: body?.state,
            selectedId: body?.selectedId,
            feedback: body?.feedback,
            availableSeats: body?.availableSeats - 1,
            transactionId: body?.transactionId,
            date: body.date,
            enrolled: body.enrolled || "successfully",
          },
        };
        // console.log(paidClass, "213");
        const result = await classCollection.updateOne(
          query,
          paidClass,
          options
        );
        // console.log(result);
        res.send(result);
      }
    );
    app.delete(
      "/deleteSelectedClass/:id",
      verifyJWT,
      verifyStudent,
      async (req, res) => {
        const id = req?.params?.id;
        const filter = { _id: new ObjectId(id) };
        const result = await selectedClassCollection.deleteOne(filter);
        res.send(result);
      }
    );
    app.get("/TopInstructor", async (req, res) => {
      const filter = { role: "instructor" };
      const result = await userCollection.find(filter).limit(6).toArray();
      res.send(result);
    });
    app.get("/allInstructor", async (req, res) => {
      const filter = { role: "instructor" };
      const result = await userCollection.find(filter).toArray();
      res.send(result);
    });
    app.get("/usersManage", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });
    app.get("/users", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });
    // comment
    app.post("/comment", async (req, res) => {
      const body = req.body;
      console.log(body);
      const result = await commentCollection.insertOne(body);
      res.send(result);
    });
    app.get("/myComment", async (req, res) => {
      const result = await commentCollection.find().toArray();
      // console.log(result);
      res.send(result);
    });
    // add classes
    app.post("/addClass", verifyJWT, verifyInstructor, async (req, res) => {
      const body = req.body;
      const result = await classCollection.insertOne(body);
      res.send(result);
    });
    app.get(
      "/getClass/:email",
      verifyJWT,
      verifyInstructor,
      async (req, res) => {
        const email = req.params.email;
        const query = { instructorEmail: email };
        const pendingData = await classCollection
          .find({
            $and: [query, { state: "pending" }],
          })
          .toArray();

        const remainingData = await classCollection
          .find({
            $and: [query, { state: { $ne: "pending" } }],
          })
          .toArray();
        const result = pendingData.concat(remainingData);
        res.send(result);
      }
    );
    app.get("/upcomingClasses", async (req, res) => {
      const upComingData = await classCollection
        .find({ state: "upcoming" })
        .limit(3)
        .toArray();
      res.send(upComingData);
    });
    app.get("/allUpcomingClasses", async (req, res) => {
      const upComingData = await classCollection
        .find({ state: "upcoming" })
        .toArray();
      res.send(upComingData);
    });
    app.get("/AllClass", verifyJWT, verifyAdmin, async (req, res) => {
      const pendingData = await classCollection
        .find({ state: "pending" })
        .toArray();
      const upcoming = await classCollection
        .find({ state: "upcoming" })
        .toArray();
      const remainingData = await classCollection
        .find({ state: { $nin: ["pending", "upcoming"] } })
        .toArray();
      const result = pendingData.concat(upcoming).concat(remainingData);
      console.log(result);

      res.send(result);
    });
    app.get("/AllClassByViewr", async (req, res) => {
      const state = { state: "Approve" };
      const result = await classCollection.find(state).toArray();
      res.send(result);
    });
    app.get(
      "/enrollClasses/:email",
      verifyJWT,
      verifyStudent,
      async (req, res) => {
        const email = req.params.email;
        const state = { enrolled: "successfully", studentEmail: email };
        const result = await classCollection.find(state).toArray();
        res.send(result);
      }
    );
    app.get(
      "/paymentHistoryDone/:email",
      verifyJWT,
      verifyStudent,
      async (req, res) => {
        const email = req.params.email;
        const state = { enrolled: "successfully", studentEmail: email };
        const result = await classCollection
          .find(state)
          .sort({ date: -1 })
          .toArray();
        res.send(result);
      }
    );
    app.delete(
      "/deleteBeforePayment/:id",
      verifyJWT,
      verifyStudent,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const result = await selectedClassCollection.deleteOne(filter);
        res.send(result);
      }
    );
    app.get("/popularClasses", async (req, res) => {
      const result = await classCollection
        .find({})
        .sort({ enrollStudent: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });
    app.patch(
      "/updateClass/:id",
      verifyJWT,
      verifyInstructor,
      async (req, res) => {
        const id = req.params.id;
        const body = req.body;
        // console.log(body);
        const query = { _id: new ObjectId(id) };
        const options = { upsert: true };
        const updateClass = {
          $set: {
            imgURL: body.imgURL,
            className: body.className,
            price: parseFloat(body.price),
            availableSeats: parseFloat(body.availableSeats),
          },
        };
        const result = await classCollection.updateOne(
          query,
          updateClass,
          options
        );
        res.send(result);
      }
    );
    app.patch("/feedBack/:id", async (req, res) => {
      const id = req.params.id;
      // console.log(id);
      const body = req.body;
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateStateForFeedBack = {
        $set: {
          state: body.state,
        },
      };
      const result = await classCollection.updateOne(
        query,
        updateStateForFeedBack,
        options
      );
      res.send(result);
    });
    app.patch("/UpdateFeedBack/:id", async (req, res) => {
      const id = req.params.id;
      // console.log(id);
      const body = req.body;
      // console.log(body, "209");
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateClassForFeedBack = {
        $set: {
          feedback: body.feedback,
        },
      };
      const result = await classCollection.updateOne(
        query,
        updateClassForFeedBack,
        options
      );
      res.send(result);
    });
    app.patch(
      "/updateUserRole/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        // console.log(id);
        const body = req.body;
        const query = { _id: new ObjectId(id) };
        const options = { upsert: true };
        const updateUserRole = {
          $set: {
            role: body.role,
          },
        };
        const result = await userCollection.updateOne(
          query,
          updateUserRole,
          options
        );
        res.send(result);
      }
    );
    app.delete("/deleteClass/:id", async (req, res) => {
      const id = req.params.id;
      // console.log(id);
      const query = { _id: new ObjectId(id) };
      const result = await classCollection.deleteOne(query);
      res.send(result);
    });
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", async (req, res) => {
  res.send("testing server");
});

app.listen(port, () => {
  console.log(`CreativaDesignHub is sitting on port ${port}`);
});
