const axios = require('axios');
const xml2js = require('xml2js');
const { initializeApp } = require("firebase/app");
const { getFirestore, doc, setDoc, Timestamp } = require("firebase/firestore");

// --- 1. CONFIGURATION ---
const TALLY_URL = 'http://localhost:9000';

// PASTE YOUR FIREBASE CONFIG HERE (Between the curly braces)
const firebaseConfig = {
      apiKey: "AIzaSyCW6QMHok6SU-PkmMMEKF65ob_anT08tzc",
  authDomain: "tallyconnect-7b4eb.firebaseapp.com",
  projectId: "tallyconnect-7b4eb",
  storageBucket: "tallyconnect-7b4eb.firebasestorage.app",
  messagingSenderId: "134855390523",
  appId: "1:134855390523:web:77a46a09a0f82a7a05b31e"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- 2. HELPERS ---
const generateRequest = (groupName) => `
<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Group Summary</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                    <GROUPNAME>${groupName}</GROUPNAME>
                </STATICVARIABLES>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>`;

async function parseTallyResponse(xmlData) {
    const parser = new xml2js.Parser();
    try {
        const result = await parser.parseStringPromise(xmlData);
        // Navigate through Tally's complex XML tree
        const collection = result?.ENVELOPE?.DSPACCNAME;
        if (!collection) return 0;
        
        let total = 0;
        collection.forEach(ledger => {
             const val = ledger['DSPACCINFO']?.[0]['DSPCLAMTA']?.[0]?.['_'] || "0";
             total += Math.abs(parseFloat(val));
        });
        return total;
    } catch (e) { return 0; }
}

// --- 3. MAIN LOOP ---
async function sync() {
    console.log("🔄 Connecting to Tally...");
    try {
        // Fetch Data
        const [sales, cash, bank] = await Promise.all([
            axios.post(TALLY_URL, generateRequest("Sales Accounts"), { headers: {'Content-Type': 'text/xml'} }),
            axios.post(TALLY_URL, generateRequest("Cash-in-hand"), { headers: {'Content-Type': 'text/xml'} }),
            axios.post(TALLY_URL, generateRequest("Bank Accounts"), { headers: {'Content-Type': 'text/xml'} })
        ]);

        const data = {
            sales: await parseTallyResponse(sales.data),
            cash: await parseTallyResponse(cash.data),
            bank: await parseTallyResponse(bank.data),
            lastUpdated: Timestamp.now()
        };

        console.log("📊 Data:", data);

        // Upload to Cloud
        await setDoc(doc(db, "companies", "client_001"), data);
        console.log("✅ Synced to Cloud.");

    } catch (err) {
        console.log("❌ Error: Is Tally Open? (Port 9000)");
    }
}

// Run every 10 seconds
sync();
setInterval(sync, 10000);