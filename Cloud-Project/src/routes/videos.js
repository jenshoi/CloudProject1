
const express = require('express'); //setter opp router
const router = express.Router(); //video-related routes in same file

const controller = require('../controllers/videos'); //hvor vi definerer hva som skjer når en route kalles
const upload = require('../middleware/multer'); // multer middleware som håndterer opplastingen i selve videofilen

//Replaced by cognito
//const { login } = require('../auth/users'); //users
//const { requireAdmin } = require('../auth/users'); //Must be admin
//const { authMiddleware } = require('../auth/users'); //users

//sjekker innlogging + leser filen i multer + Sender videoen videre til.py filen.

//Changed
router.post('/analyze', upload.single('video'), controller.analyzeVideo);  //have to be logged in to analyze video
router.get('/:id', controller.getResult); //henter status på en video (med id) og resultat fra controller hvor selve beregningen skjer
router.get('/:id/stream', controller.streamOutput); //henter data fra video med en spesifikk id. Dataen som hentes er den ferdig tellede videoen med firkanter rundt bilene
router.get('/:id/images', controller.listImages);
//router.post('/login', login); //sender login videre
router.get('/', controller.listAll)


//For later: router.get('/admin', requireGroup('admin'), ctrl.listAllAdmin);

router.post('/presign-upload', authMiddleware, controller.presignUpload);
router.post('/analyze-from-s3', authMiddleware, controller.analyzeFromS3);


module.exports = router; //eksporter



