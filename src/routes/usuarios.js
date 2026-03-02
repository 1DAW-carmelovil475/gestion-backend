const express      = require('express');
const router       = express.Router();
const supabaseAdmin = require('../supabase');
const { authGuard, adminGuard } = require('../middleware/auth');

router.get('/', authGuard, adminGuard, async (req, res) => {
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles').select('id, nombre, rol, activo, created_at').order('created_at');
    if (error) return res.status(500).json({ error: error.message });

    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    if (authError) return res.status(500).json({ error: authError.message });

    const emailMap = {};
    authUsers.users.forEach(u => { emailMap[u.id] = u.email; });
    res.json(profiles.map(p => ({ ...p, email: emailMap[p.id] || '—' })));
});

router.post('/', authGuard, adminGuard, async (req, res) => {
    const { nombre, email, rol, password } = req.body;
    if (!nombre || !email || !rol || !password) {
        return res.status(400).json({ error: 'Nombre, email, rol y contraseña son obligatorios.' });
    }
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email.toLowerCase().trim(),
        password,
        email_confirm: true,
        user_metadata: { nombre, rol },
    });
    if (authError) {
        if (authError.message.includes('already registered')) {
            return res.status(409).json({ error: 'Ya existe un usuario con ese email.' });
        }
        return res.status(500).json({ error: authError.message });
    }
    await supabaseAdmin.from('profiles').upsert(
        { id: authData.user.id, nombre, rol },
        { onConflict: 'id' }
    );
    res.status(201).json({ id: authData.user.id, email: authData.user.email, nombre, rol, activo: true });
});

router.put('/:id', authGuard, adminGuard, async (req, res) => {
    const { nombre, rol, activo } = req.body;
    const updates = {};
    if (nombre !== undefined) updates.nombre = nombre;
    if (rol    !== undefined) updates.rol    = rol;
    if (activo !== undefined) updates.activo = activo;
    const { data, error } = await supabaseAdmin
        .from('profiles').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.delete('/:id', authGuard, adminGuard, async (req, res) => {
    if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

module.exports = router;