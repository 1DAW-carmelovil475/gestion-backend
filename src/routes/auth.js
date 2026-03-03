const express = require('express');
const router  = express.Router();
const { authGuard } = require('../middleware/auth');
const supabaseAdmin = require('../supabase');

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña son requeridos.' });
    }

    try {
        // Autenticar con Supabase Auth usando el cliente admin
        const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
            email,
            password,
        });

        if (authError) {
            return res.status(401).json({ error: authError.message || 'Email o contraseña incorrectos.' });
        }

        // Obtener el perfil del usuario
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('id, rol, activo, nombre')
            .eq('id', authData.user.id)
            .single();

        if (profileError || !profile) {
            return res.status(401).json({ error: 'Perfil de usuario no encontrado.' });
        }

        if (!profile.activo) {
            return res.status(403).json({ error: 'Cuenta desactivada.' });
        }

        // Devolver el token y datos del usuario
        res.json({
            access_token: authData.session.access_token,
            refresh_token: authData.session.refresh_token,
            user: {
                id: profile.id,
                email: authData.user.email,
                nombre: profile.nombre,
                rol: profile.rol,
            },
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

router.get('/me', authGuard, (req, res) => {
    res.json({
        id:     req.user.id,
        email:  req.user.email,
        nombre: req.user.nombre,
        rol:    req.user.rol,
    });
});

// ── Refresh Token ─────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
    const { refresh_token } = req.body;

    if (!refresh_token) {
        return res.status(400).json({ error: 'Refresh token requerido.' });
    }

    try {
        const { data, error } = await supabaseAdmin.auth.refreshSession({
            refresh_token,
        });

        if (error) {
            return res.status(401).json({ error: error.message || 'Token de refresco inválido.' });
        }

        res.json({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
        });
    } catch (error) {
        console.error('Error en refresh:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

module.exports = router;   