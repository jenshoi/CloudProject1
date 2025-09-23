const express = require("express");
const { signUpHandler, confirmHandler, loginHandler } = require("../auth/cognito");

const router = express.Router();

router.post("/signup", signUpHandler);
router.post("/confirm", confirmHandler);     // body: { username, code }
router.post("/login", loginHandler);         // returns id/access tokens

module.exports = router;
