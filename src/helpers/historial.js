const supabaseAdmin = require('../supabase');

async function registrarHistorial(ticketId, userId, tipo, descripcion, datos = {}) {
    const { error } = await supabaseAdmin.from('ticket_historial').insert({
        ticket_id: ticketId,
        user_id: userId,
        tipo,
        descripcion,
        datos,
    });
    if (error) console.error('Error registrando historial:', error.message);
}

function calcularHorasTranscurridas(ticket) {
    let totalMs = ticket.tiempo_acumulado_ms || 0;
    // Si está "En curso", sumar el tiempo activo actual
    if (ticket.estado === 'En curso' && ticket.en_curso_desde) {
        totalMs += Date.now() - new Date(ticket.en_curso_desde).getTime();
    }
    return Math.max(0, Math.round(totalMs / 360000) / 10);
}

module.exports = { registrarHistorial, calcularHorasTranscurridas };