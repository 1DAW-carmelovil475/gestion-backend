const express       = require('express');
const router        = express.Router();
const supabaseAdmin = require('../supabase');
const { authGuard, adminGuard } = require('../middleware/auth');
const { registrarHistorial } = require('../helpers/historial');

router.get('/', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('tickets_v2')
        .select('id, numero, asunto, descripcion, prioridad, estado, created_at, empresa_id, empresas(id, nombre)')
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.post('/', authGuard, async (req, res) => {
    const { empresa_id, asunto, descripcion, prioridad, estado } = req.body;
    if (!empresa_id || !asunto) return res.status(400).json({ error: 'empresa_id y asunto son obligatorios.' });
    const { data, error } = await supabaseAdmin
        .from('tickets_v2')
        .insert({ empresa_id, asunto, descripcion, prioridad: prioridad || 'Media', estado: estado || 'Pendiente', created_by: req.user.id })
        .select().single();
    if (error) return res.status(500).json({ error: error.message });
    await registrarHistorial(data.id, req.user.id, 'creacion', `Ticket creado por ${req.user.nombre || req.user.email}`);
    res.status(201).json(data);
});

router.put('/:id', authGuard, async (req, res) => {
    const { estado } = req.body;
    const updates = { ...req.body };
    if (estado === 'En curso')               updates.started_at   = updates.started_at   || new Date().toISOString();
    if (estado === 'Completado')             updates.completed_at = updates.completed_at || new Date().toISOString();
    if (estado === 'Pendiente de facturar')  updates.completed_at = updates.completed_at || new Date().toISOString();
    if (estado === 'Facturado')              updates.invoiced_at  = updates.invoiced_at  || new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('tickets_v2').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.delete('/:id', authGuard, adminGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('tickets_v2').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

module.exports = router;