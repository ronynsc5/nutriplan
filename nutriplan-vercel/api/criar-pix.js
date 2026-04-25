// api/criar-pix.js
// Cria uma cobrança Pix no Mercado Pago e devolve o QR Code para o frontend

export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // Permite requisições do seu site (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { email, nome, plano } = req.body;

  if (!email || !plano) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  const precos = {
    economico: { valor: 9.90, descricao: 'NutriPlan Base — 1 crédito' },
    premium:   { valor: 19.90, descricao: 'NutriPlan Performance — 1 crédito' }
  };

  const item = precos[plano];
  if (!item) return res.status(400).json({ error: 'Plano inválido' });

  try {
    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // ACCESS TOKEN fica aqui no servidor — nunca exposto no HTML
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        // ID único por requisição para evitar cobranças duplicadas
        'X-Idempotency-Key': `${email}-${plano}-${Date.now()}`
      },
      body: JSON.stringify({
        transaction_amount: item.valor,
        description: item.descricao,
        payment_method_id: 'pix',
        payer: {
          email: email,
          first_name: nome || 'Cliente'
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Erro MP:', data);
      return res.status(500).json({ error: 'Erro ao criar Pix', detalhe: data.message });
    }

    // Devolve só o que o frontend precisa
    return res.status(200).json({
      pagamentoId: data.id,
      pixCopiaECola: data.point_of_interaction?.transaction_data?.qr_code,
      qrCodeBase64: data.point_of_interaction?.transaction_data?.qr_code_base64,
      status: data.status
    });

  } catch (err) {
    console.error('Erro interno:', err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
