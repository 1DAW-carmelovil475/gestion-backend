const express       = require('express');
const router        = express.Router();
const supabaseAdmin = require('../supabase');
const { authGuard } = require('../middleware/auth');

router.get('/', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id, nombre, rol, activo')
        .in('rol', ['admin', 'trabajador'])
        .eq('activo', true)
        .order('nombre');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

module.exports = router;