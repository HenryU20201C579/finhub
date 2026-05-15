/* Mobile specific JS for Caja Chica */

document.addEventListener("DOMContentLoaded", () => {
    if (window.innerWidth <= 768) {
        initMobileInterface();
    }
});

function initMobileInterface() {
    console.log("Initializing Caja Chica Mobile Interface...");

    // 1. Inject Floating Action Button (FAB)
    const fab = document.createElement('button');
    fab.className = 'fab-add-mobile';
    fab.innerHTML = '<i class="fas fa-plus"></i>';
    fab.title = "Nueva Caja Chica";
    fab.onclick = (e) => {
        e.preventDefault();
        if (typeof window.openNewBox === 'function') {
            window.openNewBox();
        }
    };
    document.body.appendChild(fab);

    // 2. Handle Browser Back Navigation
    // Relies purely on index.js for history logic
}

// Helper to manage history state
function pushHistoryState() {
    // Disabled: handled by index.js
}

// Helper to pop history if needed (when closed programmatically/by button)
function popHistoryState(fromPopState) {
    // Disabled: handled by index.js
}


// Hook into openDetailPane to handle mobile view
const originalOpenDetail = window.openDetailPane;
window.openDetailPane = function () {
    if (originalOpenDetail) originalOpenDetail();

    if (window.innerWidth <= 768) {
        pushHistoryState();
        // Hide FAB when detail is open
        const fab = document.querySelector('.fab-add-mobile');
        if (fab) {
            fab.style.opacity = '0';
            fab.style.transform = 'scale(0.5) translateY(20px)';
            setTimeout(() => { fab.style.display = 'none'; }, 300);
        }
        document.body.style.overflow = 'hidden'; // Block scroll
    }
};

// Hook into closeDetailPane to restore mobile view
const originalCloseDetail = window.closeDetailPane;
window.closeDetailPane = function (fromPopState = false) {
    // If called from button, we need to pop state. If from popstate event, we don't.
    // However, original function doesn't take args. We need to handle this carefully.

    // Check if pane is actually open before doing anything to avoid double closes
    const pane = document.getElementById('right-pane');
    if (!pane || !pane.classList.contains('active')) return;

    if (originalCloseDetail) originalCloseDetail();

    popHistoryState(fromPopState);

    if (window.innerWidth <= 768) {
        // Show FAB when detail is closed
        setTimeout(() => {
            const fab = document.querySelector('.fab-add-mobile');
            if (fab) {
                fab.style.display = 'flex';
                requestAnimationFrame(() => {
                    fab.style.opacity = '1';
                    fab.style.transform = 'scale(1) translateY(0)';
                });
            }
            document.body.style.overflow = ''; // Restore scroll
        }, 300);
    }
};

// Hook into other modals if necessary
const originalOpenHistory = window.openPaymentsHistory;
window.openPaymentsHistory = function (name) {
    if (originalOpenHistory) originalOpenHistory(name);
    if (window.innerWidth <= 768) {
        pushHistoryState();
        document.body.style.overflow = 'hidden';
    }
};

const originalCloseHistory = window.closePaymentsHistory;
window.closePaymentsHistory = function (fromPopState = false) {
    const modal = document.getElementById('paymentsHistoryModal');
    if (!modal || !modal.classList.contains('active')) return;

    if (originalCloseHistory) originalCloseHistory();
    popHistoryState(fromPopState);

    if (window.innerWidth <= 768) {
        document.body.style.overflow = '';
    }
};

// Hooking other modals
const hookModal = (openFnName, closeFnName, modalId) => {
    const originalOpen = window[openFnName];
    const originalClose = window[closeFnName];

    window[openFnName] = function (...args) {
        if (originalOpen) originalOpen(...args);
        if (window.innerWidth <= 768) {
            pushHistoryState();
            document.body.style.overflow = 'hidden';
        }
    };

    window[closeFnName] = function (fromPopState = false) {
        const modal = document.getElementById(modalId);
        if (!modal || !modal.classList.contains('active')) return;

        if (originalClose) originalClose();
        popHistoryState(fromPopState);

        // Only enable scroll if no other modals are active (simplified)
        if (window.innerWidth <= 768) {
            // A bit naive, but works for single layer modals usually
            let anyActive = document.querySelectorAll('.modal-backdrop.active').length > 0;
            if (!anyActive) document.body.style.overflow = '';
        }
    };
};

// Apply hooks to known modals
hookModal('openPaymentModal', 'closePaymentModal', 'paymentModal');
hookModal('viewPaymentDetail', 'closePaymentDetailModal', 'paymentDetailModal'); // viewPaymentDetail is the open function
// For Attachment Modal, the open is 'prepareAttachmentUpload' which is internal/callback based, mostly triggered by code.
// We can hook the result or manually handle it. Since prepareAttachmentUpload calls classList.add, let's hook a wrapper or rely on the fact it's called.
// BUT, prepareAttachmentUpload is NOT global window function in index.js, it is function declaration. 
// We can't easily hook it from here unless we modify index.js.
// However, 'window.closeAttachmentModal' IS global. 
// Let's hook 'closeAttachmentModal' and we need a way to hook open.
// Since we cannot hook the internal 'prepareAttachmentUpload' easily without modifying index.js deeply or copy-pasting,
// we will assume for now that if the user manually opens it (e.g. quick create might open others), we retain behavior.
// Actually, 'prepareAttachmentUpload' is global scope in index.js (it's defined as function prepareAttachmentUpload... in global scope of file, so it IS window.prepareAttachmentUpload if not in module).
// Checking index.js... it is defined at top level. So it is window.prepareAttachmentUpload.

// Let's try to hook it.
if (typeof window.prepareAttachmentUpload === 'function') {
    const originalPrep = window.prepareAttachmentUpload;
    window.prepareAttachmentUpload = function (file) {
        if (originalPrep) originalPrep(file);
        if (window.innerWidth <= 768) {
            pushHistoryState();
        }
    }
}
hookModal('dummyOpen', 'closeAttachmentModal', 'attachmentCategoryModal'); // We hooked open manually above

hookModal('openQuickCreateModal', 'closeQuickCreateModal', 'quickCreateModal');
