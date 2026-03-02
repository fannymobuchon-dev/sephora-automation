const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');

const app = express();
app.use(express.json());

// Fonction pour uploader une capture sur Imgur
async function uploadToImgur(buffer) {
  try {
    const formData = new FormData();
    formData.append('image', new Blob([buffer]));

    const response = await axios.post('https://api.imgur.com/3/image', formData, {
      headers: {
        'Authorization': 'Client-ID 515fbc084588583',
      },
    });

    return response.data.data.link;
  } catch (error) {
    console.error('Erreur Imgur:', error.message);
    return null;
  }
}

// Fonction pour capturer une page
async function capturePageScreenshot(browser, url) {
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const screenshot = await page.screenshot({ fullPage: true });
    await page.close();
    return screenshot;
  } catch (error) {
    console.error('Erreur capture page:', error.message);
    return null;
  }
}

// Fonction pour capturer un élément spécifique
async function captureElement(page, selector) {
  try {
    const element = await page.$(selector);
    if (!element) return null;
    const screenshot = await element.screenshot();
    return screenshot;
  } catch (error) {
    console.log(`Erreur capture élément ${selector}:`, error.message);
    return null;
  }
}

// Fonction pour extraire l'URL d'une bannière
async function extractBannerUrl(page, selector) {
  try {
    const url = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return null;
      
      const link = element.querySelector('a');
      if (link) return link.href;
      
      return null;
    }, selector);
    
    return url;
  } catch (error) {
    console.log(`Erreur extraction URL ${selector}:`, error.message);
    return null;
  }
}

// Route principale
app.post('/capture', async (req, res) => {
  const { country, domain, notionToken, notionDatabaseId } = req.body;

  console.log(`Démarrage capture pour ${country}...`);

  let browser;
  try {
    // Lancer Puppeteer avec les bonnes options pour Render
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    });

    const homepage = `https://www.sephora.${domain}/`;
    const page = await browser.newPage();
    
    // Augmenter le timeout
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);
    
    await page.goto(homepage, { waitUntil: 'networkidle2', timeout: 60000 });

    console.log(`✓ Homepage chargée: ${homepage}`);

    // 1. Capturer la homepage complète
    const homepageScreenshot = await page.screenshot({ fullPage: true });
    const homepageUrl = await uploadToImgur(homepageScreenshot);
    console.log(`✓ Homepage capturée: ${homepageUrl}`);

    // 2. Capturer les bannières
    const mainBannerScreenshot = await captureElement(page, '[data-layer-banner-action="main banner"]');
    const mainBannerUrl = mainBannerScreenshot ? await uploadToImgur(mainBannerScreenshot) : null;
    console.log(`✓ Main Banner capturée: ${mainBannerUrl}`);

    const ub1Screenshot = await captureElement(page, '[data-layer-banner-action="main under banner 1"]');
    const ub1Url = ub1Screenshot ? await uploadToImgur(ub1Screenshot) : null;
    console.log(`✓ UB1 capturée: ${ub1Url}`);

    const ub2Screenshot = await captureElement(page, '[data-layer-banner-action="main under banner 2"]');
    const ub2Url = ub2Screenshot ? await uploadToImgur(ub2Screenshot) : null;
    console.log(`✓ UB2 capturée: ${ub2Url}`);

    // 3. Extraire les URLs de redirection
    const mainBannerRedirectUrl = await extractBannerUrl(page, '[data-layer-banner-action="main banner"]');
    const ub1RedirectUrl = await extractBannerUrl(page, '[data-layer-banner-action="main under banner 1"]');
    const ub2RedirectUrl = await extractBannerUrl(page, '[data-layer-banner-action="main under banner 2"]');

    console.log(`✓ URLs extraites`);

    // 4. Capturer les pages de redirection
    let redirectMainUrl = null;
    let redirectUb1Url = null;
    let redirectUb2Url = null;

    if (mainBannerRedirectUrl) {
      const redirectScreenshot = await capturePageScreenshot(browser, mainBannerRedirectUrl);
      redirectMainUrl = redirectScreenshot ? await uploadToImgur(redirectScreenshot) : null;
      console.log(`✓ Redirection Main Banner capturée`);
    }

    if (ub1RedirectUrl) {
      const redirectScreenshot = await capturePageScreenshot(browser, ub1RedirectUrl);
      redirectUb1Url = redirectScreenshot ? await uploadToImgur(redirectScreenshot) : null;
      console.log(`✓ Redirection UB1 capturée`);
    }

    if (ub2RedirectUrl) {
      const redirectScreenshot = await capturePageScreenshot(browser, ub2RedirectUrl);
      redirectUb2Url = redirectScreenshot ? await uploadToImgur(redirectScreenshot) : null;
      console.log(`✓ Redirection UB2 capturée`);
    }

    await page.close();

    // 5. Envoyer à Notion
    const weekNumber = Math.ceil((new Date().getDate() - new Date().getDay() + 4) / 7);
    
    if (notionToken && notionDatabaseId) {
      const notionPayload = {
        parent: { database_id: notionDatabaseId },
        properties: {
          'Semaine': { number: weekNumber },
          'Pays': { select: { name: country } },
          'Homepage': { url: homepageUrl },
          'Redirection Main': { url: redirectMainUrl },
          'Redirection UB1': { url: redirectUb1Url },
          'Redirection UB2': { url: redirectUb2Url },
        },
      };

      await axios.post('https://api.notion.com/v1/pages', notionPayload, {
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28',
        },
      });

      console.log(`✓ Données envoyées à Notion pour ${country}`);
    }

    res.json({
      success: true,
      country,
      homepageUrl,
      mainBannerUrl,
      ub1Url,
      ub2Url,
      redirectMainUrl,
      redirectUb1Url,
      redirectUb2Url,
    });
  } catch (error) {
    console.error(`✗ Erreur pour ${country}:`, error.message);
    res.status(500).json({ error: error.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Route de test
app.get('/', (req, res) => {
  res.send('Serveur Sephora Automation est actif ! 🚀');
});

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Serveur lancé sur le port ' + (process.env.PORT || 3000));
});
