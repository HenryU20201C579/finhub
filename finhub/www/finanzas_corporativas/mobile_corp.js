// Mobile Logic for Finanzas Corporativas
document.addEventListener("DOMContentLoaded", () => {
    if (window.innerWidth <= 768) {
        initMobileInterface();
    }
});

function initMobileInterface() {
    console.log("Initializing Mobile Interface (Finanzas Corp)...");

    const fab = document.createElement('button');
    fab.className = 'fab-add';
    fab.innerHTML = '<i class="fas fa-plus"></i>';
    fab.onclick = () => window.openNewExpense();
    document.body.appendChild(fab);

    const rucInput = document.getElementById('inputRuc');
    if (rucInput) {
        rucInput.addEventListener('focus', () => {
            setTimeout(() => {
                rucInput.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300);
        });
    }
}

function applyMobileModalOpen() {
    if (window.innerWidth > 768) return;
    const fab = document.querySelector('.fab-add');
    if (fab) {
        fab.style.opacity = '0';
        fab.style.transform = 'scale(0.5) translateY(20px)';
        setTimeout(() => { fab.style.display = 'none'; }, 300);
    }
    document.body.style.overflow = 'hidden';
}

function applyMobileModalClose() {
    if (window.innerWidth > 768) return;
    setTimeout(() => {
        const fab = document.querySelector('.fab-add');
        if (fab) {
            fab.style.display = 'flex';
            requestAnimationFrame(() => {
                fab.style.opacity = '1';
                fab.style.transform = 'scale(1) translateY(0)';
            });
        }
        document.body.style.overflow = '';
    }, 300);
}

const _origOpenNewExpense = window.openNewExpense;
window.openNewExpense = function (...args) {
    if (_origOpenNewExpense) _origOpenNewExpense.apply(this, args);
    applyMobileModalOpen();
};

const _origShowExpenseDetail = window.showExpenseDetail;
window.showExpenseDetail = function (...args) {
    if (_origShowExpenseDetail) _origShowExpenseDetail.apply(this, args);
    applyMobileModalOpen();
};

const _origCloseDetailModal = window.closeDetailModal;
window.closeDetailModal = function (...args) {
    if (_origCloseDetailModal) _origCloseDetailModal.apply(this, args);
    applyMobileModalClose();
};

const _origCloseAllModals = window.closeAllModals;
if (_origCloseAllModals) {
    window.closeAllModals = function (...args) {
        _origCloseAllModals.apply(this, args);
        applyMobileModalClose();
    };
}
