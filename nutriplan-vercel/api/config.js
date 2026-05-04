export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    MP_PUBLIC_KEY: process.env.MP_PUBLIC_KEY || ''
  });
} 
