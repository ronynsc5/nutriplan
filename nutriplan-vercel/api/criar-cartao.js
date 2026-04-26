// api/criar-cartao.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { token, email, nome, plano, valor, parcelas, cpf } = req.body;
  if (!token || !email || !valor) return res.status(400).json({ error: 'Dados incompletos' });

  const descricoes = {
    economico: 'NutriPlan Base — 1 crédito',
    premium: 'NutriPlan Performance — 1 crédito'
  };

  try {
    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'X-Idempotency-Key': `${email}-cartao-${plano}-${Date.now()}`
      },
      body: JSON.stringify({
        transaction_amount: parseFloat(valor),
        token,
        description: descricoes[plano] || 'NutriPlan',
        installments: parseInt(parcelas) || 1,
        payment_method_id: 'visa', // será detectado automaticamente pelo token
        payer: {
          email,
          first_name: nome?.split(' ')[0] || '',
          identification: { type: 'CPF', number: cpf?.replace(/\D/g, '') }
        }
      })
    });

    const data = await response.json();
    console.log('Cartão MP:', data.status, data.status_detail);

    return res.status(200).json({
      status: data.status,
      statusDetail: data.status_detail,
      pagamentoId: data.id
    });
  } catch (err) {
    console.error('Erro cartão:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
