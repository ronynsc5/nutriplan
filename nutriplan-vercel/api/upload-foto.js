// api/upload-foto.js
// Faz upload de foto para o Cloudinary e retorna a URL

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const CLOUD_NAME = 'dwdvblexb';
  const API_KEY = '922614986132354';
  const API_SECRET = process.env.CLOUDINARY_SECRET || 'LUE5BJUQxD0_fO-RKTwm6CwqIQ0';

  try {
    const { image, usuario_id, tipo } = req.body;
    if (!image) return res.status(400).json({ error: 'Imagem obrigatória' });

    // Gerar timestamp e assinatura
    const timestamp = Math.round(Date.now() / 1000);
    const folder = `nutriplan/${usuario_id}`;
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;

    // Assinatura SHA1
    const crypto = await import('crypto');
    const signature = crypto.default
      .createHash('sha1')
      .update(paramsToSign + API_SECRET)
      .digest('hex');

    // Upload para Cloudinary
    const formData = new URLSearchParams();
    formData.append('file', image);
    formData.append('api_key', API_KEY);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder', folder);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      { method: 'POST', body: formData }
    );

    const data = await response.json();

    if (data.error) return res.status(400).json({ error: data.error.message });

    return res.status(200).json({
      url: data.secure_url,
      public_id: data.public_id,
      width: data.width,
      height: data.height
    });

  } catch (err) {
    console.error('Cloudinary error:', err);
    return res.status(500).json({ error: 'Erro ao fazer upload' });
  }
}
