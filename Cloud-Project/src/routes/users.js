const express = require('express');
const router = express.Router();
const { login } = require('../auth/users');


// sender videre
router.post('/login', login);

module.exports = router;
