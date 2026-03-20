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
        .select(`id, estado, prioridad, created_at, completed_at, invoiced_at, ticket_asignaciones(user_id, asignado_at)`);
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

    const now = new Date();
    const ESTADOS_CERRADO = ['Completado', 'Pendiente de facturar', 'Facturado'];
    const map = {};
    tickets?.forEach(ticket => {
        const esCerrado = ESTADOS_CERRADO.includes(ticket.estado);
        const fechaCierre = ticket.invoiced_at || ticket.completed_at;
        const closeTime = esCerrado ? (fechaCierre ? new Date(fechaCierre) : null) : now;

        ticket.ticket_asignaciones?.forEach(a => {
            if (!map[a.user_id]) {
                map[a.user_id] = {
                    id: a.user_id, nombre: profileMap[a.user_id] || '?',
                    tickets_totales: 0, tickets_completados: 0, tickets_pendientes: 0,
                    horas_por_ticket: [], tiempos_resolucion: [],
                };
            }
            map[a.user_id].tickets_totales++;

            // Horas automáticas: desde asignado_at hasta cierre (o ahora si sigue abierto)
            if (a.asignado_at && closeTime) {
                const h = (closeTime - new Date(a.asignado_at)) / 3600000;
                if (h > 0) map[a.user_id].horas_por_ticket.push(h);
            }

            if (esCerrado) {
                map[a.user_id].tickets_completados++;
                if (ticket.created_at && fechaCierre) {
                    map[a.user_id].tiempos_resolucion.push(
                        (new Date(fechaCierre) - new Date(ticket.created_at)) / 3600000
                    );
                }
            }
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
        media_horas: op.horas_por_ticket.length
            ? op.horas_por_ticket.reduce((a, b) => a + b, 0) / op.horas_por_ticket.length
            : null,
        tiempo_promedio_horas: op.tiempos_resolucion.length
            ? op.tiempos_resolucion.reduce((a, b) => a + b, 0) / op.tiempos_resolucion.length
            : null,
    })));
});

router.get('/empresas', authGuard, adminGuard, async (req, res) => {
    const { desde, hasta } = req.query;
    let query = supabaseAdmin
        .from('tickets_v2')
        .select('empresa_id, estado, prioridad, created_at, completed_at, invoiced_at, empresas(nombre)');
    if (desde) query = query.gte('created_at', desde);
    if (hasta) query = query.lte('created_at', hasta + 'T23:59:59');

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const ESTADOS_CERRADO = ['Completado', 'Pendiente de facturar', 'Facturado'];
    const map = {};
    data?.forEach(t => {
        if (!map[t.empresa_id]) {
            map[t.empresa_id] = {
                id: t.empresa_id, nombre: t.empresas?.nombre,
                total: 0, pendientes: 0, en_curso: 0, completados: 0,
                pendiente_facturar: 0, facturados: 0, urgentes: 0,
                _tiempos: [],
            };
        }
        map[t.empresa_id].total++;
        if (t.estado === 'Pendiente')             map[t.empresa_id].pendientes++;
        if (t.estado === 'En curso')              map[t.empresa_id].en_curso++;
        if (t.estado === 'Completado')            map[t.empresa_id].completados++;
        if (t.estado === 'Pendiente de facturar') map[t.empresa_id].pendiente_facturar++;
        if (t.estado === 'Facturado')             map[t.empresa_id].facturados++;
        if (t.prioridad === 'Urgente')            map[t.empresa_id].urgentes++;

        if (ESTADOS_CERRADO.includes(t.estado) && t.created_at) {
            const fechaCierre = t.invoiced_at || t.completed_at;
            if (fechaCierre) {
                const h = (new Date(fechaCierre) - new Date(t.created_at)) / 3600000;
                if (h > 0) map[t.empresa_id]._tiempos.push(h);
            }
        }
    });

    res.json(Object.values(map).map(e => {
        const media_horas = e._tiempos.length
            ? e._tiempos.reduce((a, b) => a + b, 0) / e._tiempos.length
            : null;
        const { _tiempos, ...rest } = e;
        return { ...rest, media_horas };
    }).sort((a, b) => b.total - a.total));
});

module.exports = router;