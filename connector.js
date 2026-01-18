const axios = require('axios');
const xml2js = require('xml2js');
const { initializeApp } = require("firebase/app");
const { getFirestore, doc, setDoc, Timestamp } = require("firebase/firestore");

// --- CONFIGURATION ---
const TALLY_URL = 'http://localhost:9000';

// PASTE YOUR FIREBASE CONFIG HERE
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

// --- TALLY XML REQUEST ---
// This asks for a list of all parties in a group (Debtors or Creditors)
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

// --- PARSER ---
async function parsePartyList(xmlData) {
    const parser = new xml2js.Parser();
    try {
        const result = await parser.parseStringPromise(xmlData);
        // Navigate Tally's messy XML to find the list of ledgers
        const ledgers = result?.ENVELOPE?.DSPACCNAME || [];
        
        // Convert the XML list into a clean Javascript list
        return ledgers.map(ledger => {
            const name = ledger?.DSPDISPNAME?.[0] || "Unknown Party";
            const amountStr = ledger?.DSPACCINFO?.[0]?.DSPCLAMTA?.[0]?._ || "0";
            return {
                name: name,
                amount: Math.abs(parseFloat(amountStr)) // Convert text to number
            };
        }).filter(item => item.amount > 0); // Only show parties with a balance
    } catch (e) {
        console.log("Error parsing:", e);
        return [];
    }
}

// --- MAIN SYNC FUNCTION ---
async function sync() {
    console.log("🔄 Asking Tally for Bills...");
    try {
        // 1. Get Receivables (Sundry Debtors)
        const debtRes = await axios.post(TALLY_URL, generateRequest("Sundry Debtors"), { headers: {'Content-Type': 'text/xml'} });
        const receivables = await parsePartyList(debtRes.data);

        // 2. Get Payables (Sundry Creditors)
        const credRes = await axios.post(TALLY_URL, generateRequest("Sundry Creditors"), { headers: {'Content-Type': 'text/xml'} });
        const payables = await parsePartyList(credRes.data);

        console.log(`✅ Found: ${receivables.length} Debtors, ${payables.length} Creditors.`);

        // 3. Send to Firebase
        await setDoc(doc(db, "companies", "client_001"), {
            receivables: receivables, // List of people who owe us
            payables: payables,       // List of people we owe
            lastUpdated: Timestamp.now()
        });
        
        console.log("☁️ Uploaded to Cloud!");

    } catch (err) {
        console.log("❌ Connection Failed. Is Tally Open with a Company Loaded?");
    }
}

// Run immediately then every 30 seconds
sync();
setInterval(sync, 30000);