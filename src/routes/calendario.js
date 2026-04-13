// ============================================
// CALENDARIO — CRUD de eventos + avisos + emails
// ============================================

const router = require('express').Router();
const supabase = require('../supabase');
const { authGuard, adminGuard } = require('../middleware/auth');
const { getPerfilesConEmail } = require('../helpers/email');
const { enviarEmailEventoAsignado, enviarEmailRecordatorio } = require('../helpers/emailCalendario');

router.use(authGuard);

// ── Helper: enriquecer eventos (perfiles, asignaciones, empresa, tickets, dispositivos) ──
async function enriquecerEventos(eventos) {
    if (!eventos?.length) return eventos;

    const eventoIds = eventos.map(e => e.id).filter(Boolean);
    const userIds   = new Set();
    eventos.forEach(e => { if (e.creado_por) userIds.add(e.creado_por); });

    // ── 1. Asignaciones de operarios ─────────────────────────────
    let asignMap = {};
    if (eventoIds.length) {
        const { data: asignaciones } = await supabase
            .from('calendario_evento_asignaciones')
            .select('evento_id, user_id')
            .in('evento_id', eventoIds);
        (asignaciones || []).forEach(a => {
            if (!asignMap[a.evento_id]) asignMap[a.evento_id] = [];
            asignMap[a.evento_id].push(a.user_id);
            userIds.add(a.user_id);
        });
    }

    // ── 2. Perfiles de usuarios ──────────────────────────────────
    const perfMap = {};
    if (userIds.size > 0) {
        const { data: perfiles } = await supabase
            .from('profiles').select('id, nombre').in('id', [...userIds]);
        (perfiles || []).forEach(p => { perfMap[p.id] = p.nombre; });
    }

    // ── 3. Empresas ──────────────────────────────────────────────
    const empresaIds = [...new Set(eventos.filter(e => e.empresa_id).map(e => e.empresa_id))];
    const empresaMap = {};
    if (empresaIds.length) {
        const { data: emps } = await supabase
            .from('empresas').select('id, nombre').in('id', empresaIds);
        (emps || []).forEach(emp => { empresaMap[emp.id] = emp; });
    }

    // ── 4. Tickets vinculados ────────────────────────────────────
    let ticketsMap = {};
    if (eventoIds.length) {
        const { data: evTickets } = await supabase
            .from('calendario_evento_tickets')
            .select('evento_id, tickets_v2(id, numero, asunto, estado, prioridad)')
            .in('evento_id', eventoIds);
        (evTickets || []).forEach(r => {
            if (!ticketsMap[r.evento_id]) ticketsMap[r.evento_id] = [];
            if (r.tickets_v2) ticketsMap[r.evento_id].push(r.tickets_v2);
        });
    }

    // ── 5. Dispositivos vinculados ───────────────────────────────
    let disposMap = {};
    if (eventoIds.length) {
        const { data: evDispos } = await supabase
            .from('calendario_evento_dispositivos')
            .select('evento_id, dispositivos(id, nombre, categoria, ip)')
            .in('evento_id', eventoIds);
        (evDispos || []).forEach(r => {
            if (!disposMap[r.evento_id]) disposMap[r.evento_id] = [];
            if (r.dispositivos) disposMap[r.evento_id].push(r.dispositivos);
        });
    }

    return eventos.map(e => ({
        ...e,
        creador:                 e.creado_por ? { nombre: perfMap[e.creado_por] || null } : null,
        asignados:               (asignMap[e.id] || []).map(uid => ({ id: uid, nombre: perfMap[uid] || null })),
        empresa:                 e.empresa_id ? (empresaMap[e.empresa_id] || null) : null,
        tickets_vinculados:      ticketsMap[e.id]  || [],
        dispositivos_vinculados: disposMap[e.id]   || [],
    }));
}

// ── GET /  — Listar todos los eventos (vista compartida para todos) ───────
router.get('/', async (req, res) => {
    try {
        const { desde, hasta } = req.query;

        let query = supabase
            .from('calendario_eventos')
            .select('*, calendario_avisos(*)')
            .order('fecha_inicio', { ascending: true });

        if (desde) query = query.gte('fecha_inicio', desde);
        if (hasta) query = query.lte('fecha_inicio', hasta);

        const { data, error } = await query;
        if (error) throw error;
        res.json(await enriquecerEventos(data));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /todos — (Solo gestores/admin) Ver todos los eventos de todos ────
router.get('/todos', adminGuard, async (req, res) => {
    try {
        const { desde, hasta } = req.query;
        let query = supabase
            .from('calendario_eventos')
            .select('*, calendario_avisos(*)')
            .order('fecha_inicio', { ascending: true });

        if (desde) query = query.gte('fecha_inicio', desde);
        if (hasta) query = query.lte('fecha_inicio', hasta);

        const { data, error } = await query;
        if (error) throw error;
        res.json(await enriquecerEventos(data));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST / — Crear evento ────────────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { titulo, descripcion, fecha_inicio, fecha_fin, todo_el_dia, color, tipo, asignados, avisos, empresa_id, ticket_ids, dispositivo_ids } = req.body;

        if (!titulo || !fecha_inicio || !fecha_fin) {
            return res.status(400).json({ error: 'Título, fecha inicio y fecha fin son obligatorios.' });
        }

        // Solo gestores/admin pueden asignar a otros
        const asignadosIds = Array.isArray(asignados) ? asignados : [];
        const asignaOtros = asignadosIds.some(id => id !== req.user.id);
        if (asignaOtros && !['admin', 'gestor'].includes(req.user.rol)) {
            return res.status(403).json({ error: 'Solo gestores pueden asignar eventos a otros usuarios.' });
        }

        const { data: evento, error } = await supabase
            .from('calendario_eventos')
            .insert({
                titulo,
                descripcion: descripcion || null,
                fecha_inicio,
                fecha_fin,
                todo_el_dia: todo_el_dia || false,
                color: color || '#0047b3',
                tipo: tipo || 'evento',
                creado_por: req.user.id,
                empresa_id: empresa_id || null,
            })
            .select()
            .single();

        if (error) throw error;

        // Crear asignaciones múltiples
        if (asignadosIds.length) {
            await supabase.from('calendario_evento_asignaciones')
                .insert(asignadosIds.map(uid => ({ evento_id: evento.id, user_id: uid })));
        }

        // Vincular tickets
        if (Array.isArray(ticket_ids) && ticket_ids.length) {
            await supabase.from('calendario_evento_tickets')
                .insert(ticket_ids.map(tid => ({ evento_id: evento.id, ticket_id: tid })));
        }

        // Vincular dispositivos
        if (Array.isArray(dispositivo_ids) && dispositivo_ids.length) {
            await supabase.from('calendario_evento_dispositivos')
                .insert(dispositivo_ids.map(did => ({ evento_id: evento.id, dispositivo_id: did })));
        }

        // Crear avisos si se proporcionan
        if (avisos?.length) {
            const avisosData = avisos.map(min => ({
                evento_id: evento.id,
                minutos_antes: min,
            }));
            const { data: avisosCreados, error: avisosErr } = await supabase
                .from('calendario_avisos')
                .insert(avisosData)
                .select();
            if (avisosErr) console.error('[Calendario] Error creando avisos:', avisosErr.message);
            evento.calendario_avisos = avisosCreados || [];
        } else {
            evento.calendario_avisos = [];
        }

        // Enriquecer con nombres
        const [enriquecido] = await enriquecerEventos([evento]);

        // Enviar email a cada operario asignado (que no sea el propio creador)
        const nuevosParaEmail = asignadosIds.filter(id => id !== req.user.id);
        if (nuevosParaEmail.length) {
            try {
                const perfiles = await getPerfilesConEmail(nuevosParaEmail);
                for (const perfil of perfiles) {
                    await enviarEmailEventoAsignado({
                        destinatario: perfil,
                        evento: enriquecido,
                        asignadoPor: req.user.nombre || req.user.email,
                    });
                }
            } catch (emailErr) {
                console.error('[Calendario] Error enviando email de asignación:', emailErr.message);
            }
        }

        res.status(201).json(enriquecido);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── PUT /:id — Actualizar evento ─────────────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { titulo, descripcion, fecha_inicio, fecha_fin, todo_el_dia, color, tipo, asignados, completada, avisos, empresa_id, ticket_ids, dispositivo_ids } = req.body;

        // Verificar que el evento pertenece al usuario o es gestor
        const { data: existing } = await supabase
            .from('calendario_eventos')
            .select('creado_por')
            .eq('id', id)
            .single();

        if (!existing) return res.status(404).json({ error: 'Evento no encontrado.' });

        const esCreador = existing.creado_por === req.user.id;
        const esGestor = ['admin', 'gestor'].includes(req.user.rol);

        // Verificar si el usuario está asignado a este evento
        const { data: asignacionPropia } = await supabase
            .from('calendario_evento_asignaciones')
            .select('user_id')
            .eq('evento_id', id)
            .eq('user_id', req.user.id)
            .maybeSingle();

        if (!esCreador && !asignacionPropia && !esGestor) {
            return res.status(403).json({ error: 'No tienes permiso para editar este evento.' });
        }

        // Si es asignado (no creador), solo puede marcar completada
        const updateData = {};
        if (esCreador || esGestor) {
            if (titulo !== undefined) updateData.titulo = titulo;
            if (descripcion !== undefined) updateData.descripcion = descripcion;
            if (fecha_inicio !== undefined) updateData.fecha_inicio = fecha_inicio;
            if (fecha_fin !== undefined) updateData.fecha_fin = fecha_fin;
            if (todo_el_dia !== undefined) updateData.todo_el_dia = todo_el_dia;
            if (color !== undefined) updateData.color = color;
            if (tipo !== undefined) updateData.tipo = tipo;
            if (empresa_id !== undefined) updateData.empresa_id = empresa_id || null;
        }
        if (completada !== undefined) updateData.completada = completada;
        updateData.updated_at = new Date().toISOString();

        const { data: evento, error } = await supabase
            .from('calendario_eventos')
            .update(updateData)
            .eq('id', id)
            .select('*, calendario_avisos(*)')
            .single();

        if (error) throw error;

        // Actualizar asignaciones si se proporcionan (solo creador/gestor)
        if (asignados !== undefined && (esCreador || esGestor)) {
            const asignadosIds = Array.isArray(asignados) ? asignados : [];

            // Cargar asignaciones previas para calcular nuevos
            const { data: prevAsign } = await supabase
                .from('calendario_evento_asignaciones')
                .select('user_id')
                .eq('evento_id', id);

            const prevIds = (prevAsign || []).map(a => a.user_id);
            const nuevosIds = asignadosIds.filter(uid => !prevIds.includes(uid));

            // Reemplazar todas las asignaciones
            await supabase.from('calendario_evento_asignaciones').delete().eq('evento_id', id);
            if (asignadosIds.length) {
                await supabase.from('calendario_evento_asignaciones')
                    .insert(asignadosIds.map(uid => ({ evento_id: id, user_id: uid })));
            }

            // Enviar email a nuevos asignados (que no sean el editor)
            const paraEmail = nuevosIds.filter(uid => uid !== req.user.id);
            if (paraEmail.length) {
                try {
                    const perfiles = await getPerfilesConEmail(paraEmail);
                    for (const perfil of perfiles) {
                        await enviarEmailEventoAsignado({
                            destinatario: perfil,
                            evento,
                            asignadoPor: req.user.nombre || req.user.email,
                        });
                    }
                } catch (emailErr) {
                    console.error('[Calendario] Error enviando email de asignación:', emailErr.message);
                }
            }
        }

        // Actualizar tickets vinculados
        if (ticket_ids !== undefined && (esCreador || esGestor)) {
            await supabase.from('calendario_evento_tickets').delete().eq('evento_id', id);
            if (Array.isArray(ticket_ids) && ticket_ids.length) {
                await supabase.from('calendario_evento_tickets')
                    .insert(ticket_ids.map(tid => ({ evento_id: id, ticket_id: tid })));
            }
        }

        // Actualizar dispositivos vinculados
        if (dispositivo_ids !== undefined && (esCreador || esGestor)) {
            await supabase.from('calendario_evento_dispositivos').delete().eq('evento_id', id);
            if (Array.isArray(dispositivo_ids) && dispositivo_ids.length) {
                await supabase.from('calendario_evento_dispositivos')
                    .insert(dispositivo_ids.map(did => ({ evento_id: id, dispositivo_id: did })));
            }
        }

        // Actualizar avisos si se proporcionan
        if (avisos !== undefined) {
            await supabase.from('calendario_avisos').delete().eq('evento_id', id);
            if (avisos.length) {
                const avisosData = avisos.map(min => ({
                    evento_id: id,
                    minutos_antes: min,
                }));
                const { data: avisosCreados } = await supabase
                    .from('calendario_avisos')
                    .insert(avisosData)
                    .select();
                evento.calendario_avisos = avisosCreados || [];
            } else {
                evento.calendario_avisos = [];
            }
        }

        // Enriquecer con nombres
        const [enriquecido] = await enriquecerEventos([evento]);
        res.json(enriquecido);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── DELETE /:id — Eliminar evento ────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data: existing } = await supabase
            .from('calendario_eventos')
            .select('creado_por')
            .eq('id', id)
            .single();

        if (!existing) return res.status(404).json({ error: 'Evento no encontrado.' });
        if (existing.creado_por !== req.user.id && !['admin', 'gestor'].includes(req.user.rol)) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar este evento.' });
        }

        const { error } = await supabase
            .from('calendario_eventos')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Lógica de recordatorios (usada por el cron interno y por el endpoint) ──
async function checkReminders() {
    try {
        const ahora = new Date();

        const { data: avisos, error } = await supabase
            .from('calendario_avisos')
            .select('*, calendario_eventos(*)')
            .eq('enviado', false);

        if (error) throw error;

        let enviados = 0;
        for (const aviso of avisos || []) {
            const evento = aviso.calendario_eventos;
            if (!evento) continue;

            const fechaEvento = new Date(evento.fecha_inicio);
            const fechaAviso = new Date(fechaEvento.getTime() - aviso.minutos_antes * 60000);

            if (ahora >= fechaAviso) {
                try {
                    // Enviar a todos los asignados; si no hay, al creador
                    const { data: asignaciones } = await supabase
                        .from('calendario_evento_asignaciones')
                        .select('user_id')
                        .eq('evento_id', evento.id);

                    const destinatarioIds = asignaciones?.length
                        ? asignaciones.map(a => a.user_id)
                        : [evento.creado_por];

                    const perfiles = await getPerfilesConEmail(destinatarioIds);
                    for (const perfil of perfiles) {
                        await enviarEmailRecordatorio({
                            destinatario: perfil,
                            evento,
                            minutosAntes: aviso.minutos_antes,
                        });
                    }

                    await supabase
                        .from('calendario_avisos')
                        .update({ enviado: true })
                        .eq('id', aviso.id);

                    enviados++;
                } catch (emailErr) {
                    console.error('[Calendario] Error enviando recordatorio:', emailErr.message);
                }
            }
        }

        return enviados;
    } catch (err) {
        console.error('[Calendario] Error en checkReminders:', err.message);
        return 0;
    }
}

// Cron interno: comprobar recordatorios cada 5 minutos
setTimeout(() => {
    checkReminders();
    setInterval(checkReminders, 5 * 60 * 1000);
}, 30 * 1000); // esperar 30s al arranque para que todo esté listo

// ── POST /check-reminders — Endpoint manual (útil para tests/cron externo) ──
router.post('/check-reminders', async (req, res) => {
    const enviados = await checkReminders();
    res.json({ ok: true, enviados });
});

module.exports = router;
