const express       = require('express');
const router        = express.Router();
const supabaseAdmin = require('../supabase');
const { authGuard, adminGuard } = require('../middleware/auth');

router.get('/resumen', authGuard, adminGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('tickets_v2').select('estado, prioridad, created_at');
    if (error) return res.status(500).json({ error: error.message });

    const now = new Date();
    const hace7dias = new Date(now - 7 * 86400000);

    res.json({
        total:              data.length,
        pendientes:         data.filter(t => t.estado === 'Pendiente').length,
        en_curso:           data.filter(t => t.estado === 'En curso').length,
        completados:        data.filter(t => t.estado === 'Completado').length,
        pendiente_facturar: data.filter(t => t.estado === 'Pendiente de facturar').length,
        facturados:         data.filter(t => t.estado === 'Facturado').length,
        urgentes:           data.filter(t => t.prioridad === 'Urgente').length,
        ultimos_7_dias:     data.filter(t => new Date(t.created_at) >= hace7dias).length,
    });
});

router.get('/operarios', authGuard, adminGuard, async (req, res) => {
    const { desde, hasta } = req.query;
    let query = supabaseAdmin
        .from('tickets_v2')
        .select(`id, estado, prioridad, created_at, completed_at, invoiced_at, ticket_asignaciones(user_id), ticket_horas(user_id, horas)`);
    if (desde) query = query.gte('created_at', desde);
    if (hasta) query = query.lte('created_at', hasta + 'T23:59:59');

    const { data: tickets, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const { data: todos } = await supabaseAdmin
        .from('tickets_v2').select('id, estado, ticket_asignaciones(user_id)');

    const userIds = new Set();
    tickets?.forEach(t => t.ticket_asignaciones?.forEach(a => userIds.add(a.user_id)));
    todos?.forEach(t => t.ticket_asignaciones?.forEach(a => userIds.add(a.user_id)));
    if (!userIds.size) return res.json([]);

    const { data: perfiles } = await supabaseAdmin
        .from('profiles').select('id, nombre').in('id', [...userIds]);
    const profileMap = {};
    perfiles?.forEach(p => { profileMap[p.id] = p.nombre; });

    const map = {};
    tickets?.forEach(ticket => {
        ticket.ticket_asignaciones?.forEach(a => {
            if (!map[a.user_id]) {
                map[a.user_id] = {
                    id: a.user_id, nombre: profileMap[a.user_id] || '?',
                    tickets_totales: 0, tickets_completados: 0, tickets_pendientes: 0,
                    horas_totales: 0, tiempos_resolucion: [],
                };
            }
            map[a.user_id].tickets_totales++;
            if (['Completado', 'Pendiente de facturar', 'Facturado'].includes(ticket.estado)) {
                map[a.user_id].tickets_completados++;
                const fechaCierre = ticket.invoiced_at || ticket.completed_at;
                if (ticket.created_at && fechaCierre) {
                    map[a.user_id].tiempos_resolucion.push(
                        (new Date(fechaCierre) - new Date(ticket.created_at)) / 3600000
                    );
                }
            }
        });
        ticket.ticket_horas?.forEach(h => {
            if (map[h.user_id]) map[h.user_id].horas_totales += Number(h.horas);
        });
    });

    todos?.forEach(ticket => {
        ticket.ticket_asignaciones?.forEach(a => {
            if (!map[a.user_id]) return;
            if (['Pendiente', 'En curso'].includes(ticket.estado)) map[a.user_id].tickets_pendientes++;
        });
    });

    res.json(Object.values(map).map(op => ({
        ...op,
        tiempo_promedio_horas: op.tiempos_resolucion.length
            ? op.tiempos_resolucion.reduce((a, b) => a + b, 0) / op.tiempos_resolucion.length
            : null,
    })));
});

router.get('/empresas', authGuard, adminGuard, async (req, res) => {
    const { desde, hasta } = req.query;
    let query = supabaseAdmin
        .from('tickets_v2')
        .select('empresa_id, estado, prioridad, created_at, empresas(nombre)');
    if (desde) query = query.gte('created_at', desde);
    if (hasta) query = query.lte('created_at', hasta + 'T23:59:59');

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const map = {};
    data?.forEach(t => {
        if (!map[t.empresa_id]) {
            map[t.empresa_id] = {
                id: t.empresa_id, nombre: t.empresas?.nombre,
                total: 0, pendientes: 0, en_curso: 0, completados: 0,
                pendiente_facturar: 0, facturados: 0, urgentes: 0,
            };
        }
        map[t.empresa_id].total++;
        if (t.estado === 'Pendiente')             map[t.empresa_id].pendientes++;
        if (t.estado === 'En curso')              map[t.empresa_id].en_curso++;
        if (t.estado === 'Completado')            map[t.empresa_id].completados++;
        if (t.estado === 'Pendiente de facturar') map[t.empresa_id].pendiente_facturar++;
        if (t.estado === 'Facturado')             map[t.empresa_id].facturados++;
        if (t.prioridad === 'Urgente')            map[t.empresa_id].urgentes++;
    });

    res.json(Object.values(map).sort((a, b) => b.total - a.total));
});

module.exports = router;