const express = require('express');
const app = express();
const cors = require('cors');
const admin = require("firebase-admin");
require('dotenv').config();
const { MongoClient } = require('mongodb');
const ObjectId = require('mongodb').ObjectId;
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const fileUpload = require('express-fileupload');

const port = process.env.PORT || 5000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// middleware
app.use(cors());
app.use(express.json());
app.use(fileUpload());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zxert.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
// console.log(uri);

async function verifyToken(req, res, next) {
    if (req.headers?.authorization?.startsWith('Bearer ')) {
        const token = req.headers.authorization.split(' ')[1];
        try {
            const decodedUser = await admin.auth().verifyIdToken(token);
            req.decodedEmail = decodedUser.email;
        }
        catch { }
    }
    next();
}

async function run() {
    try {
        await client.connect();
        // console.log('database connected successfully');

        const database = client.db('doctors_portal');

        // database collection for appointments
        const appointmentCollection = database.collection('appointments');

        // database collection for users
        const userCollection = database.collection('users');

        // database collection for doctors
        const doctorCollection = database.collection('doctors');

        // Get single users with email
        app.get('/appointments', verifyToken, async (req, res) => {
            const email = req.query.email;
            const date = req.query.date;
            // console.log(date);
            const query = { email: email, date: date };
            // console.log(query);
            const cursror = appointmentCollection.find(query);
            const appointments = await cursror.toArray();
            res.json(appointments);
        });

        // Get single appointment individually of a user
        app.get('/appointments/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await appointmentCollection.findOne(query);
            res.json(result);
        })

        // POST appointment
        app.post('/appointments', async (req, res) => {
            const appointment = req.body;
            // console.log(appointment);
            const result = await appointmentCollection.insertOne(appointment);
            // console.log(result);
            res.json(result);
        });

        // UPDATE appointment after payment
        app.put('/appointments/:id', async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updateDoc = {
                $set: {
                    payment: payment
                }
            };
            const result = await appointmentCollection.updateOne(filter, updateDoc);
            res.json(result);
        });

        // Get api to load doctor info with image
        app.get('/doctors', async (req, res) => {
            const cursor = doctorCollection.find({});
            const doctors = await cursor.toArray();
            res.json(doctors);
        });

        // POST api for add doctors info including a image file
        app.post('/doctors', async (req, res) => {
            // console.log('body', req.body);
            // console.log('files', req.files);
            const name = req.body.name;
            const email = req.body.email;
            const pic = req.files.image;
            const picData = pic.data;
            const encodePic = picData.toString('base64');
            const imageBuffer = Buffer.from(encodePic, 'base64');
            const doctor = {
                name,
                email,
                image: imageBuffer
            };
            const result = await doctorCollection.insertOne(doctor);
            res.json(result);
        });

        // GET users
        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            let isAdmin = false;
            if (user?.role === 'admin') {
                isAdmin = true;
            }
            res.json({ admin: isAdmin });
        });

        // POST User
        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await userCollection.insertOne(user);
            res.json(result);
        });

        // Storing user info who used google login
        app.put('/users', async (req, res) => {
            const user = req.body;
            // console.log('put', user);
            const filter = { email: user.email };
            const options = { upsert: true }; // doing UPSERT
            const updateDoc = { $set: user };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            res.json(result);
        });

        // PUT Admin, only an admin can make any user an admin
        app.put('/users/admin', verifyToken, async (req, res) => {
            const user = req.body;
            // console.log('put', req.decodedEmail);
            const requester = req.decodedEmail;
            if (requester) {
                const requesterAccount = await userCollection.findOne({ email: requester });
                if (requesterAccount.role === 'admin') {
                    const filter = { email: user.email };
                    const updateDoc = { $set: { role: 'admin' } };
                    const result = await userCollection.updateOne(filter, updateDoc);
                    res.json(result);
                }
            }
            else {
                res.status(403).json({ message: 'You do not have access to make admin' });
            }

        });

        // Payment flow
        app.post('/create-payment-intent', async (req, res) => {
            const paymentInfo = req.body;
            const amount = paymentInfo.price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                currency: "usd",
                amount: amount,
                payment_method_types: ['card']
            });
            res.json({
                clientSecret: paymentIntent.client_secret
            });
        });
    }
    finally {
        // await client.close();
    }
};

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello Doctors Portal..!!');
});

app.listen(port, () => {
    console.log('listening at:', port);
});


/* all users: app.get('/users')
single user: app.get('/users/:id')
insert one user: app.post('/users')
update one user: app.put('/users/:id')
remove one user: app.delete('/users/:id') */