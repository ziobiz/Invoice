import { Router } from 'express';
import {
  getPublicBranding,
  sendBrandingFile,
  type BrandAsset,
} from '../services/branding.js';

export const brandingRouter = Router();

brandingRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getPublicBranding());
  } catch (e) {
    next(e);
  }
});

const assets: BrandAsset[] = ['logo', 'auth-logo', 'favicon', 'background', 'og'];
for (const asset of assets) {
  brandingRouter.get(`/${asset}`, (_req, res) => {
    sendBrandingFile(res, asset);
  });
}
