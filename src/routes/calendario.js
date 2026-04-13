// ============================================
// CALENDARIO — CRUD de eventos + avisos + emails
// ============================================

const router = require('express').Router();
const supabase = require('../supabase');
const { authGuard, adminGuard } = require('../middleware/auth');
const { getPerfilesConEmail } = require('../helpers/email');
const { enviarEmailEventoAsignado, enviarEmailRecordatorio } = require('../helpers/emailCalendario');

router.use(authGuard);

// ── Helper: enriquecer eventos con nombres de creador/asignado ───────────
async function enriquecerEventos(eventos) {
    if (!eventos?.length) return eventos;

    // Recoger todos los IDs únicos
    const ids = new Set();
    eventos.forEach(e => {
        if (e.creado_por) ids.add(e.creado_por);
        if (e.asignado_a) ids.add(e.asignado_a);
    });

    if (ids.size === 0) return eventos;

    const { data: perfiles } = await supabase
        .from('profiles')
        .select('id, nombre')
        .in('id', [...ids]);

    const map = {};
    (perfiles || []).forEach(p => { map[p.id] = p.nombre; });

    return eventos.map(e => ({
        ...e,
        creador: e.creado_por ? { nombre: map[e.creado_por] || null } : null,
        asignado: e.asignado_a ? { nombre: map[e.asignado_a] || null } : null,
    }));
}

// ── GET /  — Listar eventos del usuario (propios + asignados) ────────────
router.get('/', async (req, res) => {
    try {
        const { desde, hasta } = req.query;
        let query = supabase
            .from('calendario_eventos')
            .select('*, calendario_avisos(*)')
            .or(`creado_por.eq.${req.user.id},asignado_a.eq.${req.user.id}`)
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
        const { titulo, descripcion, fecha_inicio, fecha_fin, todo_el_dia, color, tipo, asignado_a, avisos } = req.body;

        if (!titulo || !fecha_inicio || !fecha_fin) {
            return res.status(400).json({ error: 'Título, fecha inicio y fecha fin son obligatorios.' });
        }

        // Solo gestores/admin pueden asignar a otros
        if (asignado_a && asignado_a !== req.user.id) {
            if (!['admin', 'gestor'].includes(req.user.rol)) {
                return res.status(403).json({ error: 'Solo gestores pueden asignar eventos a otros usuarios.' });
            }
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
                asignado_a: asignado_a || null,
            })
            .select()
            .single();

        if (error) throw error;

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

        // Enviar email si se asigna a alguien
        if (asignado_a && asignado_a !== req.user.id) {
            try {
                const perfiles = await getPerfilesConEmail([asignado_a]);
                if (perfiles.length) {
                    await enviarEmailEventoAsignado({
                        destinatario: perfiles[0],
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
        const { titulo, descripcion, fecha_inicio, fecha_fin, todo_el_dia, color, tipo, asignado_a, completada, avisos } = req.body;

        // Verificar que el evento pertenece al usuario o es gestor
        const { data: existing } = await supabase
            .from('calendario_eventos')
            .select('creado_por, asignado_a')
            .eq('id', id)
            .single();

        if (!existing) return res.status(404).json({ error: 'Evento no encontrado.' });

        const esCreador = existing.creado_por === req.user.id;
        const esAsignado = existing.asignado_a === req.user.id;
        const esGestor = ['admin', 'gestor'].includes(req.user.rol);

        if (!esCreador && !esAsignado && !esGestor) {
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
            if (asignado_a !== undefined) updateData.asignado_a = asignado_a;
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

        // Si se acaba de asignar a alguien nuevo, enviar email
        if (asignado_a && asignado_a !== existing.asignado_a && asignado_a !== req.user.id) {
            try {
                const perfiles = await getPerfilesConEmail([asignado_a]);
                if (perfiles.length) {
                    await enviarEmailEventoAsignado({
                        destinatario: perfiles[0],
                        evento: enriquecido,
                        asignadoPor: req.user.nombre || req.user.email,
                    });
                }
            } catch (emailErr) {
                console.error('[Calendario] Error enviando email de asignación:', emailErr.message);
            }
        }

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

// ── POST /check-reminders — Comprobar y enviar recordatorios pendientes ──
// Este endpoint se puede llamar desde un cron job externo cada 5 minutos
router.post('/check-reminders', async (req, res) => {
    try {
        const ahora = new Date();

        // Buscar avisos no enviados
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
                // Determinar a quién enviar el recordatorio
                const destinatarioId = evento.asignado_a || evento.creado_por;
                try {
                    const perfiles = await getPerfilesConEmail([destinatarioId]);
                    if (perfiles.length) {
                        await enviarEmailRecordatorio({
                            destinatario: perfiles[0],
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

        res.json({ ok: true, enviados });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
