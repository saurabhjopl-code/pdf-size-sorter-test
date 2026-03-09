const fileInput = document.getElementById("pdfUpload");
const downloadBtn = document.getElementById("downloadBtn");
const downloadZipBtn = document.getElementById("downloadZipBtn");
const statusDiv = document.getElementById("status");
const summaryBody = document.querySelector("#summaryTable tbody");

const marketplaceSection = document.getElementById("marketplaceSection");
const marketplaceLogo = document.getElementById("marketplaceLogo");
const marketplaceName = document.getElementById("marketplaceName");

const progressFill = document.getElementById("progressFill");

fileInput.addEventListener("change", () => {
if(fileInput.files.length){
startProcessing();
}
});

let sortedPdfBytes;
let pages = [];
let labelType = "MEESHO";

const BATCH_SIZE = 5;

const sizeOrder = [
"XS","S","M","L","XL",
"XXL","3XL","4XL","5XL","6XL","7XL","8XL","9XL","10XL"
];

/* ===============================
SIZE NORMALIZATION
=============================== */

function normalizeSize(size){

if(!size) return "NON-SIZE";

size = size.toUpperCase().trim();

if(size === "2XL") size = "XXL";
if(size === "XXXL") size = "3XL";

if(sizeOrder.includes(size)) return size;

return "NON-SIZE";

}

/* ===============================
MARKETPLACE DETECTION
=============================== */

function detectLabelType(items){

let hasSizeHeader = false;
let hasSkuDescription = false;
let hasTracking = false;

for(let item of items){

const text = item.str.toUpperCase();

if(text === "SIZE") hasSizeHeader = true;

if(text.includes("SKU ID") || text.includes("DESCRIPTION")){
hasSkuDescription = true;
}

if(text.includes("TRACKING NO") || text.includes("OTHER DEDUCTION")){
hasTracking = true;
}

}

if(hasTracking) return "NYKAA";

if(hasSizeHeader) return "MEESHO";

if(hasSkuDescription) return "FLIPKART";

return "MEESHO";

}

/* ===============================
NYKAA PAGE CHECK
=============================== */

function isNykaaPage(items){

let keep = false;

for(let item of items){

const text = item.str.toUpperCase();

if(
text.includes("TRACKING NO") ||
text.includes("OTHER DEDUCTION") ||
text.includes("SHIPPING/CUSTOMER ADDRESS") ||
text.includes("ORDER ID")
){
keep = true;
}

}

return keep;

}

/* ===============================
MEESHO SIZE
=============================== */

function extractMeeshoSize(items){

let sizeHeader = null;

for(let item of items){

if(item.str.trim().toUpperCase() === "SIZE"){
sizeHeader = item;
break;
}

}

if(!sizeHeader) return "NON-SIZE";

const headerX = sizeHeader.transform[4];
const headerY = sizeHeader.transform[5];

let bestCandidate = null;
let bestDistance = Infinity;

for(let item of items){

const text = item.str.trim();
if(!text) continue;

const x = item.transform[4];
const y = item.transform[5];

const dx = Math.abs(x - headerX);
const dy = headerY - y;

if(dx < 15 && dy > 5 && dy < 60){

if(dy < bestDistance){
bestDistance = dy;
bestCandidate = text;
}

}

}

return normalizeSize(bestCandidate);

}

/* ===============================
FLIPKART SIZE
=============================== */

function extractFlipkartSize(items){

const skuRegex = /([A-Z0-9]{6,})-(XS|S|M|L|XL|XXL|3XL|4XL|5XL|6XL|7XL|8XL|9XL|10XL)(_|$)/i;

for(let item of items){

const text = item.str.trim();

const match = text.match(skuRegex);

if(match){

return normalizeSize(match[2]);

}

}

return "NON-SIZE";

}

/* ===============================
SIZE ROUTER
=============================== */

function extractSize(items){

if(labelType === "FLIPKART"){
return extractFlipkartSize(items);
}

return extractMeeshoSize(items);

}

/* ===============================
PROCESSING
=============================== */

async function startProcessing(){

const file = fileInput.files[0];

if(!file){
alert("Upload PDF first");
return;
}

statusDiv.innerText = "Reading PDF...";

const arrayBuffer = await file.arrayBuffer();

/* SAFE BUFFERS */

const pdfBuffer = arrayBuffer.slice(0);
const buildBuffer = arrayBuffer.slice(0);

const loadingTask = pdfjsLib.getDocument({data: pdfBuffer});
const pdf = await loadingTask.promise;

pages = [];

let sizeCount = {};
let otherSizes = new Set();

/* DETECT LABEL TYPE */

const firstPage = await pdf.getPage(1);
const firstContent = await firstPage.getTextContent();

labelType = detectLabelType(firstContent.items);

updateMarketplaceUI(labelType);

/* ===============================
NYKAA MODE
=============================== */

if(labelType === "NYKAA"){

statusDiv.innerText = "Scanning Nykaa pages...";

const { PDFDocument } = PDFLib;

const newPdf = await PDFDocument.create();
const existingPdf = await PDFDocument.load(buildBuffer);

let matchedPages = 0;

for(let i=1;i<=pdf.numPages;i++){

statusDiv.innerText =
"Scanning page " + i + " / " + pdf.numPages;

progressFill.style.width =
(i/pdf.numPages)*100 + "%";

const page = await pdf.getPage(i);
const textContent = await page.getTextContent();

if(isNykaaPage(textContent.items)){

const [copied] =
await newPdf.copyPages(existingPdf,[i-1]);

newPdf.addPage(copied);

matchedPages++;

}

}

/* SAFETY CHECK */

if(matchedPages === 0){

statusDiv.innerText =
"No Nykaa label pages detected.";

downloadBtn.disabled = true;

return;

}

sortedPdfBytes = await newPdf.save();

statusDiv.innerText =
"Nykaa labels extracted: " + matchedPages + " pages";

downloadBtn.disabled = false;

return;

}

/* ===============================
NORMAL LABEL PROCESSING
=============================== */

for(let i = 1; i <= pdf.numPages; i += BATCH_SIZE){

const batch = [];

for(let j = i; j < i + BATCH_SIZE && j <= pdf.numPages; j++){
batch.push(processPage(pdf, j));
}

const results = await Promise.all(batch);

results.forEach(result => {

const size = result.size;

if(!sizeOrder.includes(size)){
otherSizes.add(size);
}

pages.push(result);

sizeCount[size] = (sizeCount[size] || 0) + 1;

});

statusDiv.innerText =
"Reading page " +
Math.min(i+BATCH_SIZE-1, pdf.numPages)
+ " / " + pdf.numPages;

progressFill.style.width =
(i/pdf.numPages)*100 + "%";

}

pages.sort((a,b)=>{

const aInBucket = sizeOrder.includes(a.size);
const bInBucket = sizeOrder.includes(b.size);

if(!aInBucket && !bInBucket){
return a.size.localeCompare(b.size);
}

if(!aInBucket) return 1;
if(!bInBucket) return -1;

return sizeOrder.indexOf(a.size) -
sizeOrder.indexOf(b.size);

});

/* BUILD SORTED PDF */

statusDiv.innerText = "Building sorted PDF...";

const { PDFDocument } = PDFLib;

const newPdf = await PDFDocument.create();
const existingPdf = await PDFDocument.load(buildBuffer);

for(let p of pages){

const [copied] =
await newPdf.copyPages(existingPdf,[p.pageNumber-1]);

newPdf.addPage(copied);

}

sortedPdfBytes = await newPdf.save();

renderSummary(sizeCount, otherSizes);

downloadBtn.disabled = false;
downloadZipBtn.disabled = false;

statusDiv.innerText = "Sorting complete";

}

/* ===============================
PROCESS SINGLE PAGE
=============================== */

async function processPage(pdf, pageNumber){

const page = await pdf.getPage(pageNumber);
const textContent = await page.getTextContent();

let size = extractSize(textContent.items);

return {
pageNumber: pageNumber,
size: size
};

}

/* ===============================
SUMMARY
=============================== */

function renderSummary(counts, otherSizes){

summaryBody.innerHTML = "";

let total = 0;

sizeOrder.forEach(size => {

if(counts[size]){

let row = document.createElement("tr");
row.innerHTML = `<td>${size}</td><td>${counts[size]}</td>`;

summaryBody.appendChild(row);

total += counts[size];

}

});

otherSizes.forEach(size => {

let row = document.createElement("tr");
row.innerHTML = `<td>NON-SIZE</td><td>${counts[size]}</td>`;

summaryBody.appendChild(row);

total += counts[size];

});

let totalRow = document.createElement("tr");

totalRow.innerHTML = `
<td style="font-weight:bold">Grand Total</td>
<td style="font-weight:bold">${total}</td>
`;

summaryBody.appendChild(totalRow);

}

/* ===============================
DOWNLOAD PDF
=============================== */

downloadBtn.addEventListener("click",()=>{

const originalName =
fileInput.files[0].name.replace(".pdf","");

const newName = originalName + "_sorted.pdf";

const blob =
new Blob([sortedPdfBytes],{type:"application/pdf"});

const url = URL.createObjectURL(blob);

const a = document.createElement("a");

a.href = url;
a.download = newName;

a.click();

});

/* ===============================
ZIP EXPORT
=============================== */

downloadZipBtn.addEventListener("click", async () => {

const file = fileInput.files[0];
const originalBuffer = await file.arrayBuffer();

const zip = new JSZip();
const { PDFDocument } = PDFLib;

const sourcePdf = await PDFDocument.load(originalBuffer);

let sizePages = {};

pages.forEach(p => {

if(!sizePages[p.size]){
sizePages[p.size] = [];
}

sizePages[p.size].push(p.pageNumber-1);

});

for(const size in sizePages){

const pdfDoc = await PDFDocument.create();

const copiedPages =
await pdfDoc.copyPages(sourcePdf,sizePages[size]);

copiedPages.forEach(p => pdfDoc.addPage(p));

const pdfBytes = await pdfDoc.save();

zip.file(size + ".pdf", pdfBytes);

}

const zipBlob = await zip.generateAsync({type:"blob"});

const url = URL.createObjectURL(zipBlob);

const a = document.createElement("a");

a.href = url;
a.download = "labels_by_size.zip";

a.click();

});

/* ===============================
MARKETPLACE UI
=============================== */

function updateMarketplaceUI(type){

marketplaceSection.style.display = "block";

if(type === "FLIPKART"){

marketplaceLogo.src = "assets/flipkart.png";
marketplaceName.innerText = "Flipkart Labels";

}

else if(type === "NYKAA"){

marketplaceLogo.src = "assets/nykaa.png";
marketplaceName.innerText = "Nykaa Labels";

}

else{

marketplaceLogo.src = "assets/meesho.jpg";
marketplaceName.innerText = "Meesho Labels";

}

}
