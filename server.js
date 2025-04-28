// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const app = express();

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/qrcodes', express.static('qrcodes'));

// Create uploads and qrcodes folders if they don't exist
const directories = ['uploads', 'qrcodes'];
directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
});

// Multer storage settings
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Memory to hold uploaded data and scan counts
const uploadsData = [];

// Route to upload image or text and generate QR
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const text = req.body.text || '';
    let qrData = '';
    const id = Date.now();
    const qrFilename = `qr_${id}.png`;
    const qrPath = path.join(__dirname, 'qrcodes', qrFilename);
    
    // Create a redirect URL that will track scans
    const redirectUrl = `/scan/${id}`;
    const fullRedirectUrl = `${req.protocol}://${req.get('host')}${redirectUrl}`;
    const qrUrl = `${req.protocol}://${req.get('host')}/qrcodes/${qrFilename}`;

    if (req.file) {
      // Image option selected
      const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      // Store the image URL in QR, but use our redirect URL for scanning
      qrData = fullRedirectUrl;
      
      await QRCode.toFile(qrPath, qrData);
      const uploadData = { 
        id, 
        imageUrl, 
        qrUrl, 
        scanCount: 0,
        contentType: 'image',
        originalContent: imageUrl
      };
      uploadsData.push(uploadData);
      
      return res.json(uploadData);
    } else if (text) {
      // Text option selected
      qrData = fullRedirectUrl;
      await QRCode.toFile(qrPath, qrData);
      
      const uploadData = { 
        id, 
        text, 
        qrUrl, 
        scanCount: 0,
        contentType: 'text',
        originalContent: text
      };
      uploadsData.push(uploadData);
      
      return res.json(uploadData);
    }
    
    res.status(400).json({ message: 'Invalid input' });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ message: 'Error generating QR code', error: error.message });
  }
});

// Endpoint to track QR code scans and redirect to the original content
app.get('/scan/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const qrData = uploadsData.find(item => item.id === id);
  
  if (!qrData) {
    return res.status(404).send('QR code not found');
  }
  
  // Increment scan count
  qrData.scanCount++;
  console.log(`QR code ${id} scanned. Total scans: ${qrData.scanCount}`);
  
  // Redirect to the original content
  if (qrData.contentType === 'image') {
    res.redirect(qrData.originalContent);
  } else {
    // For text content, show a simple page with the text
    res.send(`
      <html>
        <head>
          <title>QR Content</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
            .content { margin: 30px auto; max-width: 600px; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
          </style>
        </head>
        <body>
          <h1>QR Code Content</h1>
          <div class="content">
            <p>${qrData.originalContent}</p>
          </div>
          <p><small>This QR code has been scanned ${qrData.scanCount} times.</small></p>
        </body>
      </html>
    `);
  }
});

// Get all QR codes data including scan counts
app.get('/qrcodes-data', (req, res) => {
  res.json(uploadsData);
});

// API endpoint to get current scan count for a specific QR code
app.get('/api/scan-count/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const qrData = uploadsData.find(item => item.id === id);
  
  if (!qrData) {
    return res.status(404).json({ error: 'QR code not found' });
  }
  
  res.json({ id, scanCount: qrData.scanCount });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));