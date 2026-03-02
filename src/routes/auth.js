const express = require('express');
const router  = express.Router();
const { authGuard } = require('../middleware/auth');

router.get('/me', authGuard, (req, res) => {
    res.json({
        id:     req.user.id,
        email:  req.user.email,
        nombre: req.user.nombre,
        rol:    req.user.rol,
    });
});

module.exports = router;