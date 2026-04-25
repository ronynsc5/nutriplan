// api/verificar-pix.js
// O frontend chama esta rota a cada 3 segundos para saber se o Pix foi pago

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'ID do pagamento obrigatório' });

  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
      }
    });

    const pagamento = await response.json();

    return res.status(200).json({
      status: pagamento.status,        // "pending", "approved", "rejected"
      aprovado: pagamento.status === 'approved'
    });

  } catch (err) {
    return res.status(500).json({ error: 'Erro ao verificar' });
  }
}
