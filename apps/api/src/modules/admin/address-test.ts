import { Router } from 'express';
import { validateAddressFreeform } from '../../lib/google-address.js';

export const addressTestRouter = Router();

addressTestRouter.post('/', async (req, res) => {
  const { address } = req.body;

  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' });
  }

  try {
    const result = await validateAddressFreeform(address.trim());
    return res.json(result);
  } catch (error) {
    console.error('Address test error:', error);
    return res.status(500).json({ error: String(error) });
  }
});
