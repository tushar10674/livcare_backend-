const ImageKit = require('@imagekit/nodejs');

const { env, requireEnv } = require('./env');

const getImageKit = () => {
  return new ImageKit({
    publicKey: env.imagekitPublicKey || requireEnv('IMAGEKIT_PUBLIC_KEY'),
    privateKey: env.imagekitPrivateKey || requireEnv('IMAGEKIT_PRIVATE_KEY'),
    urlEndpoint: env.imagekitUrlEndpoint || requireEnv('IMAGEKIT_URL_ENDPOINT'),
  });
};

module.exports = { getImageKit };
