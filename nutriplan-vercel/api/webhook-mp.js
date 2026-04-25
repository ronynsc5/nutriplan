// api/webhook-mp.js
// O Mercado Pago chama esta URL automaticamente quando o Pix é pago
// Você configura essa URL no painel do Mercado Pago

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Mercado Pago manda GET para validar a URL — responde 200
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { type, data } = req.body;

  // Só nos interessa notificação de pagamento
  if (type !== 'payment') {
    return res.status(200).json({ ignorado: true });
  }

  const pagamentoId = data?.id;
  if (!pagamentoId) return res.status(400).json({ error: 'ID inválido' });

  try {
    // Consulta o pagamento na API do MP para confirmar se foi pago de verdade
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, {
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
      }
    });

    const pagamento = await response.json();

    // Só processa se o status for "approved"
    if (pagamento.status !== 'approved') {
      return res.status(200).json({ status: pagamento.status, acao: 'nenhuma' });
    }

    // ─────────────────────────────────────────────────────────
    // AQUI: libera o crédito do usuário no seu banco de dados
    //
    // Como o NutriPlan usa localStorage (dados no navegador do
    // usuário), não tem como o servidor alterar diretamente.
    //
    // OPÇÃO A (mais simples): o frontend fica consultando
    //   /api/verificar-pix?id=PAGAMENTO_ID a cada 3 segundos.
    //   Quando aprovado, libera o crédito localmente.
    //
    // OPÇÃO B (mais robusto): usar um banco de dados como
    //   Supabase, Firebase ou PlanetScale para persistir créditos.
    //
    // Por enquanto, logamos o evento. O frontend usa a Opção A.
    // ─────────────────────────────────────────────────────────

    console.log(`✅ Pagamento aprovado: ID ${pagamentoId} | Email: ${pagamento.payer?.email} | Valor: R$${pagamento.transaction_amount}`);

    return res.status(200).json({ ok: true, pagamentoId, status: 'approved' });

  } catch (err) {
    console.error('Erro webhook:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
