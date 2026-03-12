const express       = require('express');
const router        = express.Router();
const supabaseAdmin = require('../supabase');
const { authGuard } = require('../middleware/auth');

router.get('/', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('empresas').select('*').order('nombre');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.post('/', authGuard, async (req, res) => {
    const { nombre, cif } = req.body;
    if (!nombre || !cif) return res.status(400).json({ error: 'Nombre y CIF son obligatorios.' });
    const { data, error } = await supabaseAdmin.from('empresas').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

router.put('/:id', authGuard, async (req, res) => {
    const empresaId = req.params.id;

    // Detect removed contacts to clear their user's empresa_id
    if (Array.isArray(req.body.contactos)) {
        const { data: current } = await supabaseAdmin
            .from('empresas').select('contactos').eq('id', empresaId).single();
        const oldEmails = (current?.contactos || []).map(c => c.email?.toLowerCase()).filter(Boolean);
        const newEmails = req.body.contactos.map(c => c.email?.toLowerCase()).filter(Boolean);
        const removedEmails = oldEmails.filter(e => !newEmails.includes(e));

        for (const email of removedEmails) {
            const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
            const authUser = authUsers?.users?.find(u => u.email?.toLowerCase() === email);
            if (authUser) {
                await supabaseAdmin
                    .from('profiles')
                    .update({ empresa_id: null })
                    .eq('id', authUser.id)
                    .eq('empresa_id', empresaId);
            }
        }
    }

    const { data, error } = await supabaseAdmin
        .from('empresas').update(req.body).eq('id', empresaId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.delete('/:id', authGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('empresas').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

module.exports = router;