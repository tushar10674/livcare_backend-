const { connectDB } = require('../config/db');
const { env } = require('../config/env');
const Product = require('../models/Product');
const AppSetting = require('../models/AppSetting');

const products = [
  {
    sku: 'ICU-VT-5680',
    name: 'Advanced ICU Ventilator with Touch Display',
    sub: 'V60',
    brand: 'Philips Healthcare',
    category: 'ICU Equipment',
    stock: 'in',
    mode: 'B2B',
    visible: true,
    imageUrl: 'https://images.unsplash.com/photo-1580281657527-47f249e8f75b?auto=format&fit=crop&w=1200&q=60',
    images: [
      'https://images.unsplash.com/photo-1580281657527-47f249e8f75b?auto=format&fit=crop&w=1200&q=60',
      'https://images.unsplash.com/photo-1576089172869-4f5f6f315620?auto=format&fit=crop&w=1200&q=60',
    ],
    certifications: ['CE', 'ISO', 'FDA'],
    certs: ['CE', 'ISO', 'FDA'],
    priceLabel: 'Price available on request',
    subtitle: 'Contact for bulk pricing and quotations',
    sortRank: 80,
    shortDescription: 'Advanced ventilation support for critical care settings.',
    description:
      'A modern ICU ventilator designed for critical care environments. Features multiple ventilation modes, advanced alarms, and touch display for rapid configuration.',
  },
  {
    sku: 'GE-PM-8560',
    name: 'Multi-parameter Patient Monitor 15"',
    sub: 'B650',
    brand: 'GE Healthcare',
    category: 'Patient Monitoring',
    stock: 'in',
    mode: 'Retail',
    visible: true,
    imageUrl: 'https://images.unsplash.com/photo-1582719478175-2ff0c2b0b91a?auto=format&fit=crop&w=1200&q=60',
    images: ['https://images.unsplash.com/photo-1582719478175-2ff0c2b0b91a?auto=format&fit=crop&w=1200&q=60'],
    certifications: ['CE', 'ISO'],
    certs: ['CE', 'ISO'],
    price: 285000,
    mrp: 320000,
    sortRank: 70,
    shortDescription: '15-inch multi-parameter monitor for hospital bedside care.',
    description:
      'High-resolution bedside monitor with ECG, SpO2, NIBP, temperature and configurable alarms. Suitable for ICU/OT and general wards.',
  },
  {
    sku: 'PH-OXY-EQ10',
    name: 'Medical Grade Oxygen Concentrator 10L',
    sub: 'EverFlo',
    brand: 'Philips Healthcare',
    category: 'Respiratory Care',
    stock: 'in',
    mode: 'Retail',
    visible: true,
    imageUrl: 'https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=1200&q=60',
    images: ['https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=1200&q=60'],
    certifications: ['CE', 'ISO', 'FDA'],
    certs: ['CE', 'ISO', 'FDA'],
    price: 68500,
    mrp: 75000,
    sortRank: 60,
    shortDescription: 'Continuous 10L oxygen concentration for medical environments.',
    description:
      'Reliable 10L oxygen concentrator with medical-grade filtration and durable compressor. Ideal for clinics, hospitals, and home-care setups.',
  },
  {
    sku: 'BPL-ECG-9108',
    name: '12-Channel ECG Machine with Interpretation',
    sub: 'Cardiart',
    brand: 'BPL Medical',
    category: 'Diagnostic Tools',
    stock: 'in',
    mode: 'Retail',
    visible: true,
    imageUrl: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&w=1200&q=60',
    images: ['https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&w=1200&q=60'],
    certifications: ['CE', 'ISO'],
    certs: ['CE', 'ISO'],
    price: 125000,
    mrp: 145000,
    sortRank: 50,
    shortDescription: '12-channel ECG machine with integrated interpretation support.',
    description:
      'Compact 12-lead ECG system with built-in interpretation, reporting and storage. Designed for fast throughput in diagnostic departments.',
  },
  {
    sku: 'MT-OT-3200',
    name: 'Surgical Operating Table Electric Hydraulic',
    sub: 'OT-Elite-3200',
    brand: 'Medtronic',
    category: 'Surgical Instruments',
    stock: 'in',
    mode: 'B2B',
    visible: true,
    imageUrl: 'https://images.unsplash.com/photo-1581591524425-c7e0978865b2?auto=format&fit=crop&w=1200&q=60',
    images: ['https://images.unsplash.com/photo-1581591524425-c7e0978865b2?auto=format&fit=crop&w=1200&q=60'],
    certifications: ['CE', 'ISO', 'FDA'],
    certs: ['CE', 'ISO', 'FDA'],
    priceLabel: 'Price available on request',
    subtitle: 'Contact for bulk pricing and quotations',
    sortRank: 40,
    shortDescription: 'Electric hydraulic OT table for advanced surgical theaters.',
    description:
      'Electric-hydraulic operating table supporting a wide range of surgical positions. Built for stability, easy controls, and long-term clinical use.',
  },
  {
    sku: 'US-HP',
    name: 'Portable Ultrasound Scanner with Doppler',
    sub: 'M7-Premium',
    brand: 'Mindray',
    category: 'Diagnostic Tools',
    stock: 'out',
    mode: 'B2B',
    visible: true,
    imageUrl: 'https://images.unsplash.com/photo-1581591524425-7f2bde9a8c40?auto=format&fit=crop&w=1200&q=60',
    images: ['https://images.unsplash.com/photo-1581591524425-7f2bde9a8c40?auto=format&fit=crop&w=1200&q=60'],
    certifications: ['CE', 'ISO', 'FDA'],
    certs: ['CE', 'ISO', 'FDA'],
    priceLabel: 'Price available on request',
    subtitle: 'Contact for bulk pricing and quotations',
    sortRank: 30,
    shortDescription: 'Portable Doppler-enabled ultrasound scanner for clinical diagnostics.',
    description:
      'Portable ultrasound platform with Doppler capabilities for fast bedside diagnostics. Optimized for mobility and multi-specialty use.',
  },
  {
    sku: 'PH-AED-HS1',
    name: 'Automatic External Defibrillator AED',
    sub: 'AED',
    brand: 'Philips Healthcare',
    category: 'Emergency & Trauma',
    stock: 'in',
    mode: 'Retail',
    visible: true,
    imageUrl: 'https://images.unsplash.com/photo-1581591524425-5ad0d0fbaae6?auto=format&fit=crop&w=1200&q=60',
    images: ['https://images.unsplash.com/photo-1581591524425-5ad0d0fbaae6?auto=format&fit=crop&w=1200&q=60'],
    certifications: ['CE', 'ISO', 'FDA'],
    certs: ['CE', 'ISO', 'FDA'],
    price: 185000,
    mrp: 210000,
    sortRank: 20,
    shortDescription: 'Portable AED designed for rapid response emergency care.',
    description:
      'User-friendly AED with voice prompts and automatic shock analysis for fast emergency response. Suitable for hospitals and public facilities.',
  },
  {
    sku: 'DRA-ANS-ZE',
    name: 'Anesthesia Workstation with Ventilator',
    sub: 'Zeus-IE',
    brand: 'Drager',
    category: 'Surgical Instruments',
    stock: 'in',
    mode: 'B2B',
    visible: true,
    imageUrl: 'https://images.unsplash.com/photo-1581591524425-1137d9d1b4a8?auto=format&fit=crop&w=1200&q=60',
    images: ['https://images.unsplash.com/photo-1581591524425-1137d9d1b4a8?auto=format&fit=crop&w=1200&q=60'],
    certifications: ['CE', 'ISO'],
    certs: ['CE', 'ISO'],
    priceLabel: 'Price available on request',
    subtitle: 'Contact for bulk pricing and quotations',
    sortRank: 10,
    shortDescription: 'Integrated anesthesia workstation with ventilator support.',
    description:
      'Integrated anesthesia delivery system with ventilator and monitoring-ready design. Built for OT workflows and dependable ventilation control.',
  },
];

const run = async () => {
  await connectDB(env.mongoUri);

  await Product.deleteMany({ sku: { $in: ['INF-PMP-2000', 'PPE-N95-FFP2'] } });

  await Promise.all(
    products.map((product) =>
      Product.findOneAndUpdate({ sku: product.sku }, { $set: product }, { upsert: true, new: true, setDefaultsOnInsert: true }),
    ),
  );

  const settings = await AppSetting.getSiteSettings();
  if (typeof settings.catalog?.mrpVisible !== 'boolean') {
    settings.catalog.mrpVisible = true;
    await settings.save();
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${products.length} catalog products and initialized app settings.`);
  process.exit(0);
};

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to seed catalog:', err);
  process.exit(1);
});
