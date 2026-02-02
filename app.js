// Capify store Enterprise Logic - Modern Professional Edition
const SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbwVurWjK9VkeoCeOyvF9KrYQRvvompofT0O-JlCjdnl9DFhTG1pDyR5yuz28CQF0Agh/exec';

let allDetailedOrders = [];
let lastSyncTime = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Inject Clean Professional Styles
    const style = document.createElement('style');
    style.innerHTML = `
        .status-pill { 
            padding: 4px 12px; 
            border-radius: 8px; 
            font-size: 11px; 
            font-weight: 800; 
            display: inline-flex; 
            align-items: center; 
            gap: 6px;
            border-width: 1px;
            letter-spacing: -0.2px;
        }
        .row-hover { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; }
        .row-hover:hover { background-color: rgba(59, 130, 246, 0.05) !important; }
        
        .product-tag {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.05);
            padding: 2px 8px;
            border-radius: 6px;
            font-size: 10px;
            font-weight: 700;
            color: #94a3b8;
        }
        
        .skeleton-loader {
            background: linear-gradient(90deg, #0b1120 25%, #1e293b 50%, #0b1120 75%);
            background-size: 200% 100%;
            animation: loading 1.5s infinite;
        }
        @keyframes loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    `;
    document.head.appendChild(style);

    // 1. Instant Load from Cache
    loadDataFromCache();
    
    // 2. Refresh in Background
    fetchOrdersData(allDetailedOrders.length > 0);
    initOrdersFilters(); // New: Initialize Search & Tabs

    setInterval(() => {
        if (Date.now() - lastSyncTime > 15000) fetchOrdersData(true);
    }, 45000);
});

let ordersSearchQuery = '';
let ordersStatusFilter = 'all';

function initOrdersFilters() {
    const search = document.getElementById('searchInput');
    const tabs = document.querySelectorAll('.filter-tab');

    if (search) {
        search.addEventListener('input', (e) => {
            ordersSearchQuery = e.target.value.toLowerCase();
            renderFullDetailedTable();
        });
    }

    if (tabs) {
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => {
                    t.classList.remove('active', 'font-black');
                    t.classList.add('text-slate-500', 'font-bold');
                });
                tab.classList.add('active', 'font-black');
                tab.classList.remove('text-slate-500', 'font-bold');
                
                ordersStatusFilter = tab.getAttribute('data-status');
                renderFullDetailedTable();
            });
        });
    }
}

function loadDataFromCache() {
    const cached = localStorage.getItem('capify_store_orders_cache');
    if (cached) {
        try {
            allDetailedOrders = JSON.parse(cached);
            renderFullDetailedTable();
            renderRecentDashboardOrders();
            updateDashboardStats();
            
            // Polling: Update charts as soon as they are ready in the DOM
            let attempts = 0;
            const checkCharts = setInterval(() => {
                if (window.statusChart && window.salesChart) {
                    updateChartsData();
                    clearInterval(checkCharts);
                }
                if (attempts++ > 100) clearInterval(checkCharts); // Stop after 5 seconds
            }, 50);
        } catch (e) { console.error('Cache Load Error'); }
    }
}

async function fetchOrdersData(isSilent = false) {
    const tbody = document.getElementById('fullOrdersTableBody');
    const recentBody = document.getElementById('recentOrdersBody');
    
    // Show skeleton ONLY if we have ZERO data (first time ever)
    if (!isSilent && allDetailedOrders.length === 0) {
        const skeleton = `<tr><td colspan="9" class="p-6"><div class="h-12 w-full skeleton-loader rounded-xl"></div></td></tr>`.repeat(5);
        if (tbody) tbody.innerHTML = skeleton;
        if (recentBody) recentBody.innerHTML = skeleton;
    }

    try {
        const response = await fetch(SHEET_API_URL + '?t=' + Date.now());
        const data = await response.json();
        
        const freshData = data
            .filter(row => {
                const customer = row.customer || row["\"customer\""] || row["اسم العميل"];
                return customer && customer.toString().trim() !== '';
            })
            .map(row => {
                const get = (keys) => {
                    for (let k of Object.keys(row)) {
                        const cleanK = k.toString().trim().replace(/["']/g, '').toLowerCase();
                        if (keys.includes(cleanK)) return row[k];
                    }
                    return '';
                };

                return {
                    id: (get(['id']) || 'N/A').toString().replace('#', '').trim(),
                    timestamp: get(['timestamp', 'التاريخ']) || '',
                    customer: get(['customer', 'اسم العميل']) || 'غير مسجل',
                    phone: (get(['phone', 'رقم الهاتف']) || '').toString(),
                    address: get(['address', 'العنوان']) || '',
                    content: get(['content', 'المنتج']) || '',
                    size: get(['size', 'المقاس']) || '',
                    qty: get(['qty', 'الكمية']) || 1,
                    total: get(['total payment', 'total', 'الإجمالي']) || 0,
                    status: (get(['status', 'الحالة']) || 'قيد الانتظار').trim(),
                    payment: get(['payment', 'وسيلة الدفع', 'وسيلة الدفع']) || 'عند الاستلام'
                };
            });

        // 1. SMART DEDUPLICATION: Track latest appearance in the Sheet
        const orderMap = new Map();
        freshData.forEach(row => {
            const cleanId = row.id.toString().replace('#', '').trim();
            row.id = cleanId;
            orderMap.set(cleanId, row); // Overwrites older versions, keeps latest sheet position
        });

        // 2. SORTING: Ensure newest (by date) is always at the TOP
        allDetailedOrders = Array.from(orderMap.values()).sort((a, b) => {
            const dateA = new Date(a.timestamp);
            const dateB = new Date(b.timestamp);
            return dateB - dateA; // Newest first
        });

        localStorage.setItem('capify_store_orders_cache', JSON.stringify(allDetailedOrders));
        
        renderFullDetailedTable();
        renderRecentDashboardOrders();
        updateDashboardStats();
        updateReportsData();
        updateChartsData();
    } catch (e) {
        console.error('Fetch Error:', e);
    }
}

function updateChartsData() {
    if (!allDetailedOrders || allDetailedOrders.length === 0) return;

    // 1. Update Status Performance Chart (Bar)
    if (window.statusChart) {
        const delivered = allDetailedOrders.filter(o => o.status === 'مكتمل').length;
        const returned = allDetailedOrders.filter(o => o.status === 'ملغي').length;
        const pending = allDetailedOrders.filter(o => !['مكتمل', 'ملغي'].includes(o.status)).length;
        
        window.statusChart.data.datasets[0].data = [delivered, returned, pending];
        window.statusChart.update('none'); // Silent update
    }

// 2. Update Sales Trends Chart (Line - Adaptive 7 Days)
    if (window.salesChart) {
        const labels = [];
        const dailyTotals = [];
        const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        
        // Generate last 7 days including today
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            labels.push(dayNames[d.getDay()]);
            
            const dayStart = new Date(d.setHours(0,0,0,0));
            const dayEnd = new Date(d.setHours(23,59,59,999));
            
            const total = allDetailedOrders
                .filter(o => {
                    const oDate = new Date(o.timestamp);
                    return o.status !== 'ملغي' && oDate >= dayStart && oDate <= dayEnd;
                })
                .reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
            
            dailyTotals.push(total);
        }

        window.salesChart.data.labels = labels;
        window.salesChart.data.datasets[0].data = dailyTotals;
        window.salesChart.update('none');
    }

    // 3. Update Growth Chart (Reports Page - 6 Months)
    if (window.growthChart) {
        const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
        const currentMonth = new Date().getMonth();
        const monthlyRevenue = [0, 0, 0, 0, 0, 0];
        const monthlyExpenses = [0, 0, 0, 0, 0, 0];

        // Map labels to actual months
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        for(let i=0; i<6; i++) {
            const mIdx = (currentMonth - 5 + i + 12) % 12;
            labels[i] = monthNames[mIdx];
            
            const rev = allDetailedOrders
                .filter(o => {
                    const d = new Date(o.timestamp);
                    return o.status !== 'ملغي' && d.getMonth() === mIdx;
                })
                .reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
            
            monthlyRevenue[i] = rev;
            monthlyExpenses[i] = rev * 0.45; // Estimate 45% costs
        }

        window.growthChart.data.labels = labels;
        window.growthChart.data.datasets[0].data = monthlyRevenue;
        window.growthChart.data.datasets[1].data = monthlyExpenses;
        window.growthChart.update('none');
    }

    // 4. Update Expense Donut (Reports Page)
    if (window.expenseDonut) {
        const totalRev = allDetailedOrders
            .filter(o => o.status !== 'ملغي')
            .reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
        
        // Dynamic Distribution based on total volume
        const materials = totalRev * 0.35;
        const utilities = totalRev * 0.15;
        const maintenance = totalRev * 0.10;
        const marketing = totalRev * 0.10;
        const totalCost = materials + utilities + maintenance + marketing;

        window.expenseDonut.data.datasets[0].data = [materials, utilities, maintenance, marketing];
        window.expenseDonut.update('none');

        if (document.getElementById('report-donut-total')) {
            document.getElementById('report-donut-total').innerText = `${Math.round(totalCost).toLocaleString()} EGP`;
        }
    }
}

let activeSalesView = 'weekly';
function switchSalesView(view) {
    activeSalesView = view;
    const btnW = document.getElementById('btnWeekly');
    const btnM = document.getElementById('btnMonthly');
    
    if (btnW && btnM) {
        if (view === 'weekly') {
            btnW.className = "px-4 py-1.5 text-xs font-black rounded-lg bg-slate-700 text-white shadow-sm transition-all";
            btnM.className = "px-4 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-300";
        } else {
            btnM.className = "px-4 py-1.5 text-xs font-black rounded-lg bg-slate-700 text-white shadow-sm transition-all";
            btnW.className = "px-4 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-300";
        }
    }
    updateChartsData();
}

function getStatusInfo(s) {
    const map = {
        'قيد الانتظار': { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', icon: 'schedule', text: 'بانتظار المراجعة' },
        'جاري الطباعة': { color: '#f97316', bg: 'rgba(249,115,22,0.1)', icon: 'print', text: 'جاري الطباعة' },
        'جاري التلوين': { color: '#ec4899', bg: 'rgba(236,72,153,0.1)', icon: 'palette', text: 'مرحلة التلوين' },
        'تم الشحن': { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', icon: 'local_shipping', text: 'خرج للشحن' },
        'مكتمل': { color: '#10b981', bg: 'rgba(16,185,129,0.1)', icon: 'check_circle', text: 'تم التسليم' },
        'ملغي': { color: '#f43f5e', bg: 'rgba(244,63,94,0.1)', icon: 'cancel', text: 'طلب ملغي' }
    };
    return map[s] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: 'help', text: s };
}

function renderRecentDashboardOrders() {
    const tbody = document.getElementById('recentOrdersBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    allDetailedOrders.slice(0, 5).forEach(order => {
        const st = getStatusInfo(order.status);
        const tr = document.createElement('tr');
        tr.className = "row-hover border-b border-white/[0.03]";
        
        tr.innerHTML = `
            <td class="px-6 py-5 text-center font-mono font-bold text-[11px] text-primary">#${order.id}</td>
            <td class="px-6 py-5 text-right text-[11px] text-slate-500 font-medium">${order.timestamp}</td>
            <td class="px-6 py-5 text-right">
                <div class="text-[13px] text-white font-bold leading-none">${order.customer}</div>
                <div class="text-[10px] text-slate-500 font-bold mt-1">${order.phone}</div>
            </td>
            <td class="px-6 py-5 text-right">
                <div class="text-[13px] text-white font-bold">${order.content}</div>
                <div class="flex flex-row-reverse gap-1 mt-1">
                    <span class="product-tag">${order.size}</span>
                    <span class="product-tag">×${order.qty}</span>
                </div>
            </td>
            <td class="px-6 py-5 text-center">
                <div class="text-[14px] text-white font-black">${order.total} <span class="text-[9px] font-bold text-slate-500 ml-0.5">ج.م</span></div>
            </td>
            <td class="px-6 py-5 text-center">
                <div class="status-pill" style="color: ${st.color}; background: ${st.bg}; border-color: ${st.color}20">
                    <span class="material-symbols-outlined text-[14px]">${st.icon}</span>
                    <span>${st.text}</span>
                </div>
            </td>
            <td class="px-6 py-5 text-left">
                <div class="flex items-center gap-2">
                    <button onclick="openWhatsApp('${order.phone}')" class="size-9 bg-emerald-500/10 text-emerald-500 rounded-xl hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center">
                        <span class="material-symbols-outlined text-[18px]">chat</span>
                    </button>
                    <button onclick="openEditModal('${order.id}')" class="size-9 bg-slate-800 text-slate-400 rounded-xl hover:text-white hover:bg-primary transition-all flex items-center justify-center">
                        <span class="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderFullDetailedTable() {
    const tbody = document.getElementById('fullOrdersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = allDetailedOrders.filter(order => {
        const matchesStatus = ordersStatusFilter === 'all' || order.status === ordersStatusFilter;
        const matchesSearch = order.customer.toLowerCase().includes(ordersSearchQuery) || 
                              order.phone.includes(ordersSearchQuery) ||
                              order.id.toString().includes(ordersSearchQuery);
        return matchesStatus && matchesSearch;
    });

    filtered.forEach(order => {
        const st = getStatusInfo(order.status);
        const tr = document.createElement('tr');
        tr.className = "row-hover border-b border-white/[0.03]";
        tr.innerHTML = `
            <td class="px-6 py-6 text-center font-mono font-bold text-xs text-primary">#${order.id}</td>
            <td class="px-6 py-6 text-right text-[11px] text-slate-500 font-medium">${order.timestamp}</td>
            <td class="px-6 py-6 text-right">
                <div class="text-sm text-white font-bold">${order.customer}</div>
                <div class="text-[11px] text-primary font-bold mt-1">${order.phone}</div>
            </td>
            <td class="px-6 py-6 text-right text-[11px] text-slate-400 max-w-[200px] truncate leading-relaxed">${order.address}</td>
            <td class="px-6 py-6 text-right">
                <div class="text-sm text-white font-bold">${order.content}</div>
                <div class="flex flex-row-reverse gap-1.5 mt-1.5">
                    <span class="product-tag">${order.size || 'N/A'}</span>
                    <span class="product-tag">الكمية: ${order.qty}</span>
                </div>
            </td>
            <td class="px-6 py-6 text-center">
                <div class="text-[15px] text-white font-black">${order.total} <small class="text-[10px] text-slate-500 font-bold ml-0.5">ج.م</small></div>
            </td>
            <td class="px-6 py-6 text-center">
                <div class="text-[11px] text-slate-300 font-black px-3 py-1 bg-slate-800/50 rounded-lg inline-block">${order.payment}</div>
            </td>
            <td class="px-6 py-6 text-center">
                <div class="status-pill" style="color: ${st.color}; background: ${st.bg}; border-color: ${st.color}20">
                    <span class="material-symbols-outlined text-[15px]">${st.icon}</span>
                    <span>${st.text}</span>
                </div>
            </td>
            <td class="px-6 py-6 text-left">
                <div class="flex items-center gap-2">
                    <button onclick="openWhatsApp('${order.phone}')" class="size-10 bg-emerald-500/10 text-emerald-500 rounded-xl hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center"><span class="material-symbols-outlined text-[20px]">chat</span></button>
                    <button onclick="openEditModal('${order.id}')" class="size-10 bg-slate-800 text-slate-400 rounded-xl hover:text-white hover:bg-primary transition-all flex items-center justify-center"><span class="material-symbols-outlined text-[20px]">edit</span></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateDashboardStats() {
    const valid = allDetailedOrders.filter(o => o.status !== 'ملغي');
    const total = valid.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
    const active = allDetailedOrders.filter(o => !['مكتمل', 'ملغي'].includes(o.status)).length;
    const success = allDetailedOrders.filter(o => o.status === 'مكتمل').length;
    
    if (document.getElementById('stat-total-sales')) document.getElementById('stat-total-sales').innerText = `${total.toLocaleString()} EGP`;
    if (document.getElementById('stat-active-orders')) document.getElementById('stat-active-orders').innerText = active;
    if (document.getElementById('stat-successful-orders')) document.getElementById('stat-successful-orders').innerText = success;
}

function updateReportsData() {
    if (!allDetailedOrders || allDetailedOrders.length === 0) return;

    const valid = allDetailedOrders.filter(o => o.status !== 'ملغي');
    const netRevenue = valid.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
    const returns = allDetailedOrders.filter(o => o.status === 'ملغي');
    const returnLoss = returns.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
    const avgOrder = valid.length > 0 ? (netRevenue / valid.length) : 0;
    const opsCosts = netRevenue * 0.45; // Estimated 45% for materials, energy, etc.

    if (document.getElementById('report-net-revenue')) 
        document.getElementById('report-net-revenue').innerText = `${netRevenue.toLocaleString()} EGP`;
    if (document.getElementById('report-return-loss')) 
        document.getElementById('report-return-loss').innerText = `${returnLoss.toLocaleString()} EGP`;
    if (document.getElementById('report-avg-order')) 
        document.getElementById('report-avg-order').innerText = `${avgOrder.toLocaleString()} EGP`;
    if (document.getElementById('report-ops-costs'))
        document.getElementById('report-ops-costs').innerText = `${opsCosts.toLocaleString()} EGP`;

    // Update Top Products Driver (Reports Page)
    const productStats = {};
    valid.forEach(o => {
        const name = o.content || 'Unknown Product';
        if (!productStats[name]) productStats[name] = { rev: 0, count: 0 };
        productStats[name].rev += parseFloat(o.total) || 0;
        productStats[name].count += 1;
    });

    const topProducts = Object.entries(productStats)
        .sort((a, b) => b[1].rev - a[1].rev)
        .slice(0, 3);

    const driversContainer = document.getElementById('topProductsContainer');
    if (driversContainer && topProducts.length > 0) {
        driversContainer.innerHTML = topProducts.map((p, i) => `
            <div class="flex items-center gap-4">
                <div class="size-12 rounded-2xl ${i === 0 ? 'bg-blue-500/10 text-primary' : 'bg-slate-800 text-slate-400'} flex items-center justify-center font-black border ${i === 0 ? 'border-primary/20' : 'border-slate-700'}">${i + 1}</div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-black text-white truncate">${p[0]}</p>
                    <p class="text-[10px] text-slate-500 font-bold uppercase mt-1">${p[1].count} Orders • ${p[1].rev.toLocaleString()} EGP Rev</p>
                </div>
            </div>
        `).join('');
    }

    // Update Regional Heatmap
    const regionStats = {};
    const commonCities = ["القاهرة", "الجيزة", "الاسكندرية", "التجمع", "الشيخ زايد", "المهندسين", "المعادي"];
    valid.forEach(o => {
        let found = "أقاليم أخرى";
        const addr = (o.address || "").toLowerCase();
        commonCities.forEach(city => {
            if (addr.includes(city.toLowerCase())) found = city;
        });
        regionStats[found] = (regionStats[found] || 0) + 1;
    });

    const regionsContainer = document.getElementById('regionsContainer');
    if (regionsContainer) {
        const topRegions = Object.entries(regionStats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4);
        
        const totalOrders = valid.length || 1;
        
        regionsContainer.innerHTML = topRegions.map(r => `
            <div class="p-4 bg-slate-800/30 rounded-2xl border border-slate-700/30">
                <p class="text-[10px] text-slate-500 font-black uppercase">${r[0]}</p>
                <p class="text-xl font-black text-white mt-1">${Math.round((r[1]/totalOrders)*100)}%</p>
            </div>
        `).join('');
    }
}

function openWhatsApp(phone) {
    if (!phone) return;
    let p = phone.toString().replace(/\D/g, '');
    if (!p.startsWith('20')) p = '20' + (p.startsWith('0') ? p.substring(1) : p);
    window.open(`https://wa.me/${p}`, '_blank');
}

function openModal() {
    document.getElementById('orderModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('orderModal').classList.add('hidden');
    document.body.style.overflow = 'auto';
    document.getElementById('orderForm').reset();
    document.getElementById('orderForm').querySelector('[name="orderId"]').value = '';
}

document.getElementById('orderForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const oldHtml = btn.innerHTML;
    
    // 1. Get Form Data
    const fd = new FormData(e.target);
    const rawId = fd.get('orderId');
    const isEdit = !!rawId && rawId !== 'N/A' && rawId !== '';
    
    // Generate ID if it's a new order, otherwise use the existing one
    const cleanId = isEdit ? rawId.toString().replace('#', '').trim() : Math.floor(1000 + Math.random() * 9000).toString();
    
    const orderData = {
        id: cleanId,
        timestamp: isEdit ? (allDetailedOrders.find(x => x.id == cleanId)?.timestamp || new Date().toLocaleString('en-US', { hour12: true })) : new Date().toLocaleString('en-US', { hour12: true }),
        customer: fd.get('customer') || '',
        phone: fd.get('phone') || '',
        address: fd.get('address'),
        content: fd.get('content'),
        size: fd.get('size'),
        qty: fd.get('qty'),
        total: fd.get('total'),
        payment: fd.get('payment'),
        status: fd.get('status'),
        action: isEdit ? 'updateOrder' : 'addOrder'
    };

    // 1. Instant UI Replace (Delete Old version from local state)
    if (isEdit) {
        // Force removal of ANY record with this ID to prevent UI ghosting
        allDetailedOrders = allDetailedOrders.filter(x => x.id.toString() !== cleanId);
    }
    // Always add as the latest version to top
    allDetailedOrders.unshift(orderData);
    
    renderFullDetailedTable();
    renderRecentDashboardOrders();
    updateDashboardStats();
    updateChartsData();
    closeModal();

    // 2. Clear Sync with GET (Better for row replacement scripts)
    const params = new URLSearchParams();
    params.append('action', isEdit ? 'updateOrder' : 'addOrder');
    params.append('id', cleanId);
    
    const fields = {
        'customer': orderData.customer, 'اسم العميل': orderData.customer, '"customer"': orderData.customer,
        'phone': orderData.phone, 'رقم الهاتف': orderData.phone,
        'address': orderData.address, 'العنوان': orderData.address,
        'content': orderData.content, 'المنتج': orderData.content,
        'size': orderData.size, 'المقاس': orderData.size,
        'qty': orderData.qty, 'الكمية': orderData.qty,
        'total': orderData.total, 'الإجمالي': orderData.total, '"total payment"': orderData.total,
        'status': orderData.status, 'الحالة': orderData.status,
        'payment': orderData.payment, 'وسيلة الدفع': orderData.payment,
        'timestamp': orderData.timestamp
    };

    for(let k in fields) params.append(k, fields[k] || '');

    fetch(`${SHEET_API_URL}?${params.toString()}`, { mode: 'no-cors' });
});

function openEditModal(id) {
    console.log('Opening Edit Modal for ID:', id);
    // Use loose equality (==) to match string IDs with potential numbers from data
    const o = allDetailedOrders.find(x => x.id == id);
    
    if (!o) {
        console.error('Order not found for ID:', id);
        return;
    }

    try {
        const f = document.getElementById('orderForm');
        if (!f) return;

        // Populate fields with fallback empty strings
        if (f.querySelector('[name="orderId"]')) f.querySelector('[name="orderId"]').value = o.id || '';
        if (f.querySelector('[name="customer"]')) f.querySelector('[name="customer"]').value = o.customer || '';
        if (f.querySelector('[name="phone"]')) f.querySelector('[name="phone"]').value = o.phone || '';
        if (f.querySelector('[name="address"]')) f.querySelector('[name="address"]').value = o.address || '';
        if (f.querySelector('[name="content"]')) f.querySelector('[name="content"]').value = o.content || '';
        if (f.querySelector('[name="size"]')) f.querySelector('[name="size"]').value = o.size || '';
        if (f.querySelector('[name="qty"]')) f.querySelector('[name="qty"]').value = o.qty || '1';
        if (f.querySelector('[name="total"]')) f.querySelector('[name="total"]').value = o.total || '0';
        if (f.querySelector('[name="payment"]')) f.querySelector('[name="payment"]').value = o.payment || 'عند الاستلام';
        if (f.querySelector('[name="status"]')) f.querySelector('[name="status"]').value = o.status || 'قيد الانتظار';
        
        const title = document.querySelector('#orderModal h3');
        if (title) title.innerText = 'تعديل طلب : #' + o.id;
        
        openModal();
    } catch (err) {
        console.error('Error opening edit modal:', err);
    }
}
