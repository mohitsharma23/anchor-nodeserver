const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

let SALT = 10;

const UserSchema = mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: 1,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minLen: 6,
  },
  anchors: {
    type: Array,
  },
});

UserSchema.pre("save", function (next) {
  var user = this;

  if (user.isModified("password")) {
    bcrypt.genSalt(SALT, function (err, salt) {
      if (err) return next(err);

      bcrypt.hash(user.password, salt, function (err, hash) {
        if (err) return next(err);

        user.password = hash;
        next();
      });
    });
  } else {
    next();
  }
});

UserSchema.methods.ifUserExists = function (userEmail, user) {
  User.findOne({ email: userEmail }, (err, doc) => {
    if (err) return user(err);
    user(null, doc);
  });
};

UserSchema.methods.comparePassword = function (userPass, validatePass) {
  bcrypt.compare(userPass, this.password, (err, isMatch) => {
    if (err) return validatePass(err);
    validatePass(null, isMatch);
  });
};

const User = mongoose.model("User", UserSchema);

module.exports = { User };
