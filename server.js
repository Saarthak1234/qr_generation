// server.js

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const archiver = require('archiver');
const app = express();

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/qrcodes', express.static('qrcodes'));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const METADATA_FILE = path.join(__dirname, 'qr_metadata.json');

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

// Function to load existing QR codes from the file system
async function loadExistingQRCodes() {
  try {
    // First check if metadata file exists
    if (fs.existsSync(METADATA_FILE)) {
      console.log('Loading QR codes from metadata file');
      const metadataJson = fs.readFileSync(METADATA_FILE, 'utf8');
      const metadata = JSON.parse(metadataJson);
      
      // Process each entry from metadata
      metadata.forEach(item => {
        // Create base object
        const qrUrl = `/qrcodes/${item.qrFilename}`;
        let uploadData = {
          id: item.id,
          qrUrl,
          scanCount: item.scanCount || 0,
          contentType: item.contentType,
          qrFilename: item.qrFilename
        };
        
        // Add type-specific data
        if (item.contentType === 'image') {
          const imageUrl = `/uploads/${item.uploadFilename}`;
          uploadData.imageUrl = imageUrl;
          uploadData.uploadFilename = item.uploadFilename;
          uploadData.originalContent = imageUrl;
          
          // Verify the image file exists
          const imagePath = path.join(__dirname, 'uploads', item.uploadFilename);
          if (!fs.existsSync(imagePath)) {
            console.warn(`Warning: Image file not found for QR ${item.id}: ${imagePath}`);
          }
        } else {
          uploadData.text = item.text || 'Text content not available';
          uploadData.originalContent = item.text || 'Text content not available';
        }
        
        // Verify the QR file exists
        const qrPath = path.join(__dirname, 'qrcodes', item.qrFilename);
        if (!fs.existsSync(qrPath)) {
          console.warn(`Warning: QR file not found: ${qrPath}`);
        } else {
          // Add to our data array
          uploadsData.push(uploadData);
          console.log(`Loaded from metadata: QR code ${item.id} (${item.contentType})`);
        }
      });
    } else {
      console.log('No metadata file found, falling back to directory scan');
      // Fall back to scanning directories (your original approach)
      const qrFiles = fs.readdirSync(path.join(__dirname, 'qrcodes'));
      
      // Process each QR code file
      for (const file of qrFiles) {
        if (file.startsWith('qr_') && file.endsWith('.png')) {
          // Extract ID from filename (qr_1234567890.png -> 1234567890)
          const idMatch = file.match(/qr_(\d+)\.png/);
          
          if (idMatch && idMatch[1]) {
            const id = parseInt(idMatch[1]);
            const qrFilename = file;
            const qrUrl = `/qrcodes/${file}`;
            
            // Look for corresponding upload file in uploads directory
            const uploadFiles = fs.readdirSync(path.join(__dirname, 'uploads'));
            const possibleMatch = uploadFiles.find(uploadFile => {
              return uploadFile.startsWith(id.toString());
            });
            
            if (possibleMatch) {
              // Found a matching upload file - this is an image QR code
              const uploadFilename = possibleMatch;
              const imageUrl = `/uploads/${possibleMatch}`;
              
              const uploadData = {
                id,
                qrUrl,
                imageUrl,
                scanCount: 0,
                contentType: 'image',
                originalContent: imageUrl,
                qrFilename,
                uploadFilename
              };
              
              uploadsData.push(uploadData);
              console.log(`Loaded from directory scan: QR code ${id} with image`);
            } else {
              // No matching upload file - assume it's a text QR code
              const uploadData = {
                id,
                qrUrl,
                text: "Original text content (reload lost text content)",
                scanCount: 0,
                contentType: 'text',
                originalContent: "Original text content (reload lost text content)",
                qrFilename
              };
              
              uploadsData.push(uploadData);
              console.log(`Loaded from directory scan: QR code ${id} with text`);
            }
          }
        }
      }
      
      // After loading, save metadata for future use
      saveMetadata();
    }
    
    console.log(`Loaded ${uploadsData.length} existing QR codes`);
  } catch (error) {
    console.error('Error loading existing QR codes:', error);
  }
}

// Load existing QR codes when server starts
loadExistingQRCodes();

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
    
    let uploadData;

    if (req.file) {
      // Image option selected
      const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      // Store the image URL in QR, but use our redirect URL for scanning
      qrData = fullRedirectUrl;
      
      await QRCode.toFile(qrPath, qrData);
      uploadData = { 
        id, 
        imageUrl, 
        qrUrl, 
        scanCount: 0,
        contentType: 'image',
        originalContent: imageUrl,
        qrFilename,
        uploadFilename: req.file.filename
      };
    } else if (text) {
      // Text option selected
      qrData = fullRedirectUrl;
      await QRCode.toFile(qrPath, qrData);
      
      uploadData = { 
        id, 
        text, 
        qrUrl, 
        scanCount: 0,
        contentType: 'text',
        originalContent: text,
        qrFilename
      };
    } else {
      return res.status(400).json({ message: 'Invalid input' });
    }
    
    // Add to our in-memory array
    uploadsData.push(uploadData);
    
    // Save metadata to file
    saveMetadata();
    
    return res.json(uploadData);
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ message: 'Error generating QR code', error: error.message });
  }
});

function saveMetadata() {
  try {
    // Create a copy of the data with only essential fields
    const metadataToSave = uploadsData.map(item => {
      const metadata = {
        id: item.id,
        contentType: item.contentType,
        qrFilename: item.qrFilename,
        scanCount: item.scanCount
      };
      
      // Add type-specific fields
      if (item.contentType === 'image') {
        metadata.uploadFilename = item.uploadFilename;
      } else {
        metadata.text = item.originalContent || item.text;
      }
      
      return metadata;
    });
    
    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadataToSave, null, 2));
    console.log('Metadata saved successfully');
  } catch (error) {
    console.error('Failed to save metadata:', error);
  }
}

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

// DELETE endpoint for removing a QR code
app.delete('/api/qrcode/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = uploadsData.findIndex(item => item.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'QR code not found' });
  }
  
  const qrData = uploadsData[index];
  
  try {
    // Delete QR code file
    if (qrData.qrFilename) {
      const qrPath = path.join(__dirname, 'qrcodes', qrData.qrFilename);
      if (fs.existsSync(qrPath)) {
        fs.unlinkSync(qrPath);
      }
    }
    
    // Delete uploaded image if any
    if (qrData.contentType === 'image' && qrData.uploadFilename) {
      const uploadPath = path.join(__dirname, 'uploads', qrData.uploadFilename);
      if (fs.existsSync(uploadPath)) {
        fs.unlinkSync(uploadPath);
      }
    }
    
    // Remove from array
    uploadsData.splice(index, 1);
    
    // Update metadata file
    saveMetadata();
    
    res.json({ success: true, message: 'QR code deleted successfully' });
  } catch (error) {
    console.error('Error deleting QR code:', error);
    res.status(500).json({ error: 'Failed to delete QR code', details: error.message });
  }
});

// Download all QR codes as a zip file
app.get('/download-all-qrcodes', (req, res) => {
  // Create a zip file
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  });
  
  // Set response headers
  res.attachment('all-qr-codes.zip');
  
  // Pipe archive data to response
  archive.pipe(res);
  
  // Add each QR code to the archive
  uploadsData.forEach(item => {
    if (item.qrFilename) {
      const qrPath = path.join(__dirname, 'qrcodes', item.qrFilename);
      if (fs.existsSync(qrPath)) {
        archive.file(qrPath, { name: item.qrFilename });
      }
    }
  });
  
  // Finalize archive and send response
  archive.finalize();
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));