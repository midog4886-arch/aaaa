const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const inputImage = path.join(__dirname, 'public/images/academy-logo.png');
const outputDir = path.join(__dirname, 'public/images');

async function generateIcons() {
  try {
    console.log('Generating PWA icons...');
    
    for (const size of sizes) {
      const outputPath = path.join(outputDir, `icon-${size}x${size}.png`);
      await sharp(inputImage)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 30, g: 64, b: 175, alpha: 1 } // Blue background matching theme
        })
        .png()
        .toFile(outputPath);
      console.log(`✅ Created icon-${size}x${size}.png`);
    }
    
    console.log('\\n🎉 All PWA icons generated successfully!');
  } catch (error) {
    console.error('Error generating icons:', error);
  }
}

generateIcons();
