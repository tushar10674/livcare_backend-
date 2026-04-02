const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const path = require('path');
const fs = require('fs');
const { getImageKit } = require('../config/imagekit');
const { env } = require('../config/env');
const { assertValidImageFile, ensureUploadDir, makeSafeFileName } = require('../utils/mediaUpload');

const hasImageKitConfig = () => Boolean(env.imagekitPublicKey && env.imagekitPrivateKey && env.imagekitUrlEndpoint);

const uploadToImageKit = async (req, file, buffer) => {
  const imagekit = getImageKit();
  const fileName = makeSafeFileName(req.body?.fileName || file.originalname || 'upload');
  const folder = String(req.body?.folder || '/livcare/products').trim();
  const result = await imagekit.upload({
    file: buffer.toString('base64'),
    fileName,
    folder,
    useUniqueFileName: true,
    tags: ['livcare', 'product-media'],
  });

  return {
    storage: 'imagekit',
    fileId: result.fileId,
    name: result.name,
    url: result.url,
    thumbnailUrl: result.thumbnailUrl,
    filePath: result.filePath,
    height: result.height,
    width: result.width,
    size: result.size,
    fileType: result.fileType,
    originalName: file.originalname,
    mimeType: file.mimetype,
  };
};

const uploadToLocalDisk = async (req, file, buffer) => {
  const uploadDir = await ensureUploadDir();
  const fileName = makeSafeFileName(file.originalname || 'upload');
  const fullPath = path.join(uploadDir, fileName);
  await fs.promises.writeFile(fullPath, buffer);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const publicPath = `/uploads/${fileName}`;
  return {
    storage: 'local',
    url: `${baseUrl}${publicPath}`,
    path: publicPath,
    fileName,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
};

const uploadImage = async (req, res, next) => {
  try {
    const file = req.file;
    const buffer = await assertValidImageFile(file);

    if (hasImageKitConfig()) {
      const data = await uploadToImageKit(req, file, buffer);
      return sendSuccess(res, {
        statusCode: 201,
        message: 'Uploaded',
        data,
      });
    }

    if (env.nodeEnv === 'production') {
      return next(new AppError('ImageKit must be configured for uploads in production', 500));
    }

    const data = await uploadToLocalDisk(req, file, buffer);

    return sendSuccess(res, {
      statusCode: 201,
      message: 'Uploaded',
      data,
    });
  } catch (err) {
    return next(new AppError(err?.message || 'Failed to upload file', err?.statusCode || 500));
  }
};

module.exports = { uploadImage };
