
const multer = require('multer');

const storage = multer.memoryStorage(); //storage in RAM-buffer

const limits = { fileSize: 2 * 1024 * 1024 * 1024 }; //max limit of file
const upload = multer({ storage, limits });

module.exports = upload;
