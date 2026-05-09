export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { action } = req.query;
  
  if (action === 'validar') {
    const { cupom } = req.body;
    
    // Validar cupom aqui
    // Exemplo simples:
    const cuponsValidos = ['NUTRI10', 'BEM-VINDO'];
    
    if (cuponsValidos.includes(cupom?.toUpperCase())) {
      return res.status(200).json({ 
        valido: true, 
        desconto: 10 
      });
    }
    
    return res.status(200).json({ 
      valido: false 
    });
  }
  
  return res.status(400).json({ error: 'Ação inválida' });
}
