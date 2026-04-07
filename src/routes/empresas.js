const express       = require('express');
const router        = express.Router();
const supabaseAdmin = require('../supabase');
const { authGuard } = require('../middleware/auth');

router.get('/', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('empresas').select('*').order('nombre');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

function sanitize(str, max = 300) {
    if (!str) return null;
    return String(str).trim().replace(/<[^>]*>/g, '').substring(0, max) || null;
}

router.post('/', authGuard, async (req, res) => {
    const { nombre, cif } = req.body;
    if (!nombre?.trim() || !cif?.trim()) return res.status(400).json({ error: 'Nombre y CIF son obligatorios.' });
    const safe = {
        nombre:    sanitize(req.body.nombre, 200),
        cif:       sanitize(req.body.cif, 30),
        email:     sanitize(req.body.email, 200),
        telefono:  sanitize(req.body.telefono, 30),
        direccion: sanitize(req.body.direccion, 300),
        notas:     sanitize(req.body.notas, 2000),
        servicios: Array.isArray(req.body.servicios) ? req.body.servicios : [],
        contactos: Array.isArray(req.body.contactos) ? req.body.contactos : [],
        estado:    req.body.estado || undefined,
        empresa_matriz_id: req.body.empresa_matriz_id || null,
    };
    const { data, error } = await supabaseAdmin.from('empresas').insert(safe).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

router.put('/:id', authGuard, async (req, res) => {
    const empresaId = req.params.id;

    // Detect contact changes to sync linked users
    if (Array.isArray(req.body.contactos)) {
        const { data: current } = await supabaseAdmin
            .from('empresas').select('contactos').eq('id', empresaId).single();
        const oldContacts = current?.contactos || [];
        const newContacts = req.body.contactos;

        const oldEmails = oldContacts.map(c => c.email?.toLowerCase()).filter(Boolean);
        const newEmails = newContacts.map(c => c.email?.toLowerCase()).filter(Boolean);
        const removedEmails = oldEmails.filter(e => !newEmails.includes(e));

        const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
        const allAuthUsers = authUsers?.users || [];

        // Eliminar empresa_id de usuarios cuyos contactos fueron eliminados
        for (const email of removedEmails) {
            const authUser = allAuthUsers.find(u => u.email?.toLowerCase() === email);
            if (authUser) {
                await supabaseAdmin
                    .from('profiles')
                    .update({ empresa_id: null })
                    .eq('id', authUser.id)
                    .eq('empresa_id', empresaId);
            }
        }

        // Sincronizar nombre, teléfono y email de contactos modificados
        for (const oldC of oldContacts) {
            if (!oldC.email) continue;
            const newC = newContacts.find(c => c.email?.toLowerCase() === oldC.email.toLowerCase())
                      || newContacts.find(c => c.nombre === oldC.nombre && !oldC.email);
            if (!newC) continue;
            const authUser = allAuthUsers.find(u => u.email?.toLowerCase() === oldC.email.toLowerCase());
            if (!authUser) continue;

            const profileUpdates = {};
            if (newC.nombre && newC.nombre !== oldC.nombre) profileUpdates.nombre = newC.nombre;
            if (newC.telefono !== undefined) profileUpdates.telefono = newC.telefono || '';

            if (Object.keys(profileUpdates).length > 0) {
                await supabaseAdmin.from('profiles').update(profileUpdates).eq('id', authUser.id);
            }

            // Actualizar email en auth si cambió
            if (newC.email && newC.email.toLowerCase() !== oldC.email.toLowerCase()) {
                await supabaseAdmin.auth.admin.updateUserById(authUser.id, { email: newC.email.toLowerCase() });
            }
        }
    }

    // Only allow known safe fields — strip empresa_matriz_nombre and any injected columns
    const allowed = ['nombre', 'cif', 'email', 'telefono', 'direccion', 'notas', 'servicios', 'contactos', 'estado', 'empresa_matriz_id'];
    const safe = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined) {
            if (['servicios', 'contactos'].includes(key)) {
                safe[key] = Array.isArray(req.body[key]) ? req.body[key] : [];
            } else if (key === 'empresa_matriz_id') {
                safe[key] = req.body[key] || null;
            } else {
                const s = sanitize(req.body[key], key === 'notas' ? 2000 : 300);
                if (s !== null) safe[key] = s;
            }
        }
    }

    const { data, error } = await supabaseAdmin
        .from('empresas').update(safe).eq('id', empresaId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.delete('/:id', authGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('empresas').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

module.exports = router;