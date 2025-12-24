import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { getServiceClient, listPresetAvatars } from '../services/supabaseService';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

type AvatarRequest = express.Request & { file?: Express.Multer.File; userId?: string };

export function registerAvatarRoutes(app: express.Express, authMiddleware: express.RequestHandler): void {
  app.get('/profile/avatars/presets', authMiddleware, async (_req, res) => {
    try {
      const presets = await listPresetAvatars();
      res.json({ presets });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list presets';
      res.status(500).json({ error: 'PRESET_AVATARS_FAILED', message });
    }
  });

  app.post('/profile/avatar', authMiddleware, upload.single('file'), async (req, res) => {
    const request = req as AvatarRequest;
    if (!request.file) {
      res.status(400).json({ error: 'NO_FILE', message: 'No file uploaded' });
      return;
    }
    const userId = request.userId;
    if (!userId) {
      res.status(401).json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
      return;
    }
    try {
      const buffer = await sharp(request.file.buffer)
        .resize(512, 512, { fit: 'inside' })
        .rotate()
        .jpeg({ quality: 80 })
        .toBuffer();

      const fileName = `avatars/${userId}/${uuidv4()}.jpg`;
      const supabase = getServiceClient();
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, buffer, {
          contentType: 'image/jpeg',
          upsert: false,
        });
      if (uploadError) {
        throw uploadError;
      }
      const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
      // Update profile with new avatar_url
      await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', userId);
      res.json({ avatarUrl: data.publicUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      res.status(400).json({ error: 'UPLOAD_FAILED', message });
    }
  });
}
