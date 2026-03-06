const fileInput = document.getElementById("pdfUpload");
const processBtn = document.getElementById("processBtn");
const downloadBtn = document.getElementById("downloadBtn");
const downloadZipBtn = document.getElementById("downloadZipBtn");
const statusDiv = document.getElementById("status");
const summaryBody = document.querySelector("#summaryTable tbody");

let sortedPdfBytes;
let pages = [];   // added to store page mapping

const sizeOrder = [
"XS","S","M","L","XL",
"XXL","3XL","4XL","5XL","6XL","7XL","8XL","9XL","10XL"
];

function normalizeSize(size){

if(!size) return "NON-SIZE";

size = size.toUpperCase().trim();

if(size === "2XL") size = "XXL";
if(size === "XXXL") size = "3XL";

if(sizeOrder.includes(size)) return size;

return "NON-SIZE";

}

function extractSize(items){

let sizeHeader = null;

/* find the "Size" column header */
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

/* find text directly below the Size column */
for(let item of items){

const text = item.str.trim();

if(!text) continue;

const x = item.transform[4];
const y = item.transform[5];

const dx = Math.abs(x - headerX);
const dy = headerY - y;

/* must be same column and below header */
if(dx < 15 && dy > 5 && dy < 60){

if(dy < bestDistance){
bestDistance = dy;
bestCandidate = text;
}

}

}

return normalizeSize(bestCandidate);

}

/* ===========================
   NEW - SKU EXTRACTION
   =========================== */

function extractSKU(items){

for(let item of items){

const text = item.str.trim();

if(!text) continue;

/* marketplace SKU pattern */
if(text.startsWith("JOP")) return text;

}

return "UNKNOWN";

}

processBtn.addEventListener("click", async () => {

const file = fileInput.files[0];

if(!file){
alert("Upload PDF first");
return;
}

statusDiv.innerText = "Reading PDF...";

const arrayBuffer = await file.arrayBuffer();
const pdfBuffer = arrayBuffer.slice(0);

const loadingTask = pdfjsLib.getDocument({data: pdfBuffer});
const pdf = await loadingTask.promise;

pages = [];
let sizeCount = {};
let otherSizes = new Set();

for(let i=1;i<=pdf.numPages;i++){

statusDiv.innerText = "Reading page " + i + " / " + pdf.numPages;

const page = await pdf.getPage(i);
const textContent = await page.getTextContent();

let size = extractSize(textContent.items);
let sku = extractSKU(textContent.items);

if(!sizeOrder.includes(size)){
otherSizes.add(size);
}

pages.push({
pageNumber:i,
size:size,
sku:sku
});

sizeCount[size] = (sizeCount[size] || 0) + 1;

}

const sortedOtherSizes = Array.from(otherSizes).sort();

/* ===========================
   UPDATED SORT (SIZE → SKU)
   =========================== */

pages.sort((a,b)=>{

const aInBucket = sizeOrder.includes(a.size);
const bInBucket = sizeOrder.includes(b.size);

/* both NON-SIZE */
if(!aInBucket && !bInBucket){

if(a.size === b.size){
return a.sku.localeCompare(b.sku);
}

return a.size.localeCompare(b.size);

}

/* push NON-SIZE last */
if(!aInBucket) return 1;
if(!bInBucket) return -1;

/* compare size */
const sizeCompare = sizeOrder.indexOf(a.size) - sizeOrder.indexOf(b.size);

if(sizeCompare !== 0) return sizeCompare;

/* same size → sort by SKU */
return a.sku.localeCompare(b.sku);

});

statusDiv.innerText = "Building sorted PDF...";

const { PDFDocument } = PDFLib;

const newPdf = await PDFDocument.create();
const existingPdf = await PDFDocument.load(arrayBuffer);

for(let p of pages){

const [copied] = await newPdf.copyPages(existingPdf,[p.pageNumber-1]);
newPdf.addPage(copied);

}

sortedPdfBytes = await newPdf.save();

renderSummary(sizeCount, sortedOtherSizes);

downloadBtn.disabled = false;
downloadZipBtn.disabled = false;

statusDiv.innerText = "Sorting complete";

});

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

downloadBtn.addEventListener("click",()=>{

const blob = new Blob([sortedPdfBytes],{type:"application/pdf"});

const url = URL.createObjectURL(blob);

const a = document.createElement("a");

a.href = url;
a.download = "sorted_labels.pdf";

a.click();

});


/* ===========================
   SIZE ZIP EXPORT
   =========================== */

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

const copiedPages = await pdfDoc.copyPages(
sourcePdf,
sizePages[size]
);

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
