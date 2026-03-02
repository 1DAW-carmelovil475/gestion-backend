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
    if (!ticket.created_at) return 0;
    let fechaFin;
    if (ticket.estado === 'Facturado' && ticket.invoiced_at) {
        fechaFin = new Date(ticket.invoiced_at);
    } else if (ticket.estado === 'Completado' && ticket.completed_at) {
        fechaFin = new Date(ticket.completed_at);
    } else if (ticket.estado === 'Pendiente de facturar' && ticket.completed_at) {
        fechaFin = new Date(ticket.completed_at);
    } else {
        fechaFin = new Date();
    }
    const ms = fechaFin - new Date(ticket.created_at);
    return Math.max(0, Math.round(ms / 360000) / 10);
}

module.exports = { registrarHistorial, calcularHorasTranscurridas };