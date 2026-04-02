const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const { getImageKit } = require('../config/imagekit');
const { env } = require('../config/env');
const { assertValidImageFile, makeSafeFileName } = require('../utils/mediaUpload');

const assertImageKitConfigured = () => {
  const missing = [];
  if (!env.imagekitPublicKey) missing.push('IMAGEKIT_PUBLIC_KEY');
  if (!env.imagekitPrivateKey) missing.push('IMAGEKIT_PRIVATE_KEY');
  if (!env.imagekitUrlEndpoint) missing.push('IMAGEKIT_URL_ENDPOINT');
  if (missing.length) {
    throw new AppError(`Missing ImageKit configuration: ${missing.join(', ')}`, 422);
  }
};

const getAuthParams = async (req, res, next) => {
  try {
    assertImageKitConfigured();
    const imagekit = getImageKit();
    const result = imagekit.getAuthenticationParameters();
    return sendSuccess(res, {
      data: {
        ...result,
        publicKey: env.imagekitPublicKey,
        urlEndpoint: env.imagekitUrlEndpoint,
      },
    });
  } catch (err) {
    return next(new AppError(err?.message || 'Failed to generate ImageKit auth params', 500));
  }
};

const uploadFile = async (req, res, next) => {
  try {
    const file = req.file;
    const buffer = await assertValidImageFile(file);

    assertImageKitConfigured();

    const imagekit = getImageKit();

    const originalName = file.originalname || 'upload';
    const fileName = makeSafeFileName(req.body?.fileName || originalName);
    const folder = req.body?.folder ? String(req.body.folder) : undefined;

    const result = await imagekit.upload({
      file: buffer.toString('base64'),
      fileName,
      ...(folder ? { folder } : {}),
      useUniqueFileName: true,
      tags: ['livcare', 'product-media'],
    });

    return sendSuccess(res, {
      statusCode: 201,
      message: 'Uploaded',
      data: {
        fileId: result.fileId,
        name: result.name,
        url: result.url,
        thumbnailUrl: result.thumbnailUrl,
        filePath: result.filePath,
        height: result.height,
        width: result.width,
        size: result.size,
        fileType: result.fileType,
      },
    });
  } catch (err) {
    return next(new AppError(err?.message || 'Failed to upload to ImageKit', err?.statusCode || 500));
  }
};

module.exports = { getAuthParams, uploadFile };
