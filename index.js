const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const cheerio = require("cheerio");
const convert = require("xml-js");

const { User } = require("./models/User");
const e = require("express");

const app = express();
const MONGO_URI = process.env.MONGO_DB_URI;
const jwtKey = process.env.SECRET_KEY;
const jwtExpiry = 300;

const port = process.env.PORT || 3000;

mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log("DB Connected");
  })
  .catch((err) => {
    console.log("Error ", err);
  });

app.use(bodyParser.json());

const generateToken = (email) => {
  const jwtToken = jwt.sign({ email }, jwtKey, {
    algorithm: "HS256",
    expiresIn: jwtExpiry,
  });

  return jwtToken;
};

app.post("/api/user/signup", (req, res) => {
  User().ifUserExists(req.body.email, (err, ifExist) => {
    if (err) throw err;
    if (ifExist)
      return res.status(400).json({ message: "Email already exists" });
    const user = new User({
      email: req.body.email,
      name: req.body.name,
      password: req.body.password,
      anchors: [],
    }).save((err, doc) => {
      if (err) res.status(400).send(err);
      res.status(200).json({
        token: generateToken(doc.email),
        name: doc.name,
        email: doc.email,
      });
    });
  });
});

app.post("/api/user/signin", (req, res) => {
  User.findOne({ email: req.body.email }, (err, user) => {
    if (!user) return res.status(404).json({ message: "Login Failed" });

    user.comparePassword(req.body.password, (err, isMatch) => {
      if (err) throw err;
      if (!isMatch) return res.status(401).json({ message: "Wrong Password" });

      return res.status(200).json({
        token: generateToken(req.body.email),
        name: user.name,
        email: user.email,
      });
    });
  });
});

app.post("/api/user/verifyUser", (req, res) => {
  const token = req.body.token;
  if (!token) {
    return res.status(401).end();
  }

  var payload;
  try {
    payload = jwt.verify(token, jwtKey);
  } catch (e) {
    if (e instanceof jwt.JsonWebTokenError) {
      return res.status(401).end();
    }
    return res.status(400).end();
  }
  return res.status(200).json({ email: payload.email });
});

app.post("/api/user/addanchor", (req, res) => {
  const URL = req.body.url;
  const email = req.body.email;
  const headers = {
    accept: "*/*",
    "content-type": "application/json",
    app_client: "consumer_web",
  };
  if (URL !== null) {
    let newURL = `https://${URL}`;
    axios
      .get(newURL, { headers })
      .then((response) => {
        const $ = cheerio.load(response.data);
        let feedLink = "";
        $("*").each((i, ele) => {
          if (
            feedLink === "" &&
            ($(ele).attr("type") === "application/atom+xml" ||
              $(ele).attr("type") === "application/rss+xml" ||
              ($(ele).attr("href") !== undefined &&
                $(ele).attr("href").includes("feed")))
          ) {
            let link = $(ele).attr("href");
            if (link !== null) {
              if (link.indexOf(URL) < 0) {
                feedLink = `view-source:${URL}${link}?format=xml`;
              } else {
                let subStr = link.substring(8);
                feedLink = `view-source:${subStr}?format=xml`;
              }

              axios.get(feedLink).then((xmlres) => {
                let result = convert.xml2json(xmlres.data, {
                  compact: true,
                  spaces: 4,
                });
                let jsonObj = JSON.parse(result);
                if (jsonObj.rss != null) {
                  return res
                    .status(200)
                    .send(changeData(jsonObj.rss.channel.item));
                }
              });

              User.findOneAndUpdate(
                { email: email },
                { $addToSet: { anchors: [feedLink] } },
                { new: true }
              )
                .then((doc) => {
                  // return res.status(200).json({ message: "Success" });
                  console.log("Success");
                })
                .catch((err) => {
                  console.log(err);
                  return res.status(400).json({ message: "Error" });
                });
            } else {
              res.status(400).json({
                message: "No feed is given.",
              });
            }
          }
        });
      })
      .catch((err) => {
        res.status(400).json({
          message: `Some error occured ${err}`,
        });
      });
  } else {
    res.status(400).send();
  }
});

const changeData = (data) => {
  let arr = [];

  data.forEach((e) => {
    arr.push({
      title: e.title["_text"] || e.title["_cdata"],
      link: e.link["_text"],
      pubDate: e.pubDate["_text"],
    });
  });

  return arr;
};

app.post("/api/user/getfeed", (req, res) => {
  const email = req.body.email;

  User.findOne({ email: email }, (err, doc) => {
    if (doc === null)
      return res.status(400).json({ message: "User does not exists" });

    // return res.status(200).json({ anchors: doc.anchors });
    let changedJSON = [];
    let promises = [];
    doc.anchors.forEach(async (anchor) => {
      promises.push(axios.get(anchor));
    });
    Promise.all(promises)
      .then((results) => {
        results.forEach((response) => {
          let result = convert.xml2json(response.data, {
            compact: true,
            spaces: 4,
          });
          let jsonObj = JSON.parse(result);
          if (jsonObj.rss != null) {
            changedJSON = [
              ...changedJSON,
              ...changeData(jsonObj.rss.channel.item),
            ];
          }
        });
        return res.status(200).send(changedJSON);
      })
      .catch((err) => {
        res.status(401).json({ message: "Error in retrieving data." });
      });
  });
});

app.post("/api/user/getanchors", (req, res) => {
  const email = req.body.email;

  User.findOne({ email: email }, (err, doc) => {
    if (doc !== null) {
      return res.status(200).send(doc.anchors);
    } else {
      return res.status(400).json({ message: `Error: ${err}` });
    }
  });
});

app.post("/api/user/removeanchor", (req, res) => {
  const email = req.body.email;
  const url = req.body.url;

  User.updateOne(
    { email: email },
    { $pull: { anchors: url } },
    { safe: true },
    (err, doc) => {
      if (doc === null) {
        return res.status(400).json({ message: "Error Occured" });
      }

      return res.status(200).json({ message: "Success" });
    }
  );
});

app.listen(port, () => {
  console.log(`Listening to port ${port}`);
});
