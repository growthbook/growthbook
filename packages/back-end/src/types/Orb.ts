import {
  Alert,
  CreditNote,
  Customer,
  Discount,
  Invoice,
  Subscription,
} from "orb-billing/resources";

// NOTE: I'm hopeful this is a temporary file - I've filed an issue with the package maintainers
// to add these types back into the package (their docs indicate the types previously existed)
// Link to issue - https://github.com/orbcorp/orb-node/issues/487
// The bulk of this work came from this PR (currently awaiting approval - https://github.com/orbcorp/orb-node/pull/453)

// Base webhook event interface
interface BaseWebhookEvent {
  id: string;
  created_at: string;
  type: string;
}

// Customer events
interface CustomerCreatedEvent extends BaseWebhookEvent {
  type: "customer.created";
  customer: Customer;
  properties: Record<string, never>;
}

interface CustomerEditedEvent extends BaseWebhookEvent {
  type: "customer.edited";
  customer: Customer;
  properties: {
    previous_attributes: Partial<Customer>;
  };
}

// Subscription events
interface SubscriptionEvent extends BaseWebhookEvent {
  subscription: Subscription;
}

interface SubscriptionCreatedEvent extends SubscriptionEvent {
  type: "subscription.created";
  properties: Record<string, never>;
}

interface SubscriptionStartedEvent extends SubscriptionEvent {
  type: "subscription.started";
  properties: Record<string, never>;
}

interface SubscriptionFixedFeeQuantityUpdatedEvent extends SubscriptionEvent {
  type: "subscription.fixed_fee_quantity_updated";
  properties: {
    old_quantity: number;
    new_quantity: number;
    effective_date: string;
    price_id: string;
  };
}

interface SubscriptionEditedEvent extends SubscriptionEvent {
  type: "subscription.edited";
  properties: {
    previous_attributes: Partial<Subscription>;
  };
}

interface SubscriptionEndedEvent extends SubscriptionEvent {
  type: "subscription.ended";
  properties: Record<string, never>;
}

interface SubscriptionPlanChangedEvent extends SubscriptionEvent {
  type: "subscription.plan_changed";
  properties: {
    previous_plan_id: string;
  };
}

interface SubscriptionPlanVersionChangeScheduledEvent
  extends SubscriptionEvent {
  type: "subscription.plan_version_change_scheduled";
  properties: {
    effective_date: string;
    previous_plan_version_number: number;
    new_plan_version_number: number;
  };
}

interface SubscriptionPlanVersionChangedEvent extends SubscriptionEvent {
  type: "subscription.plan_version_changed";
  properties: {
    effective_date: string;
    previous_plan_version_number: number;
    new_plan_version_number: number;
  };
}

// Invoice events
interface InvoiceEvent extends BaseWebhookEvent {
  invoice: Invoice;
}

interface InvoiceDateElapsedEvent extends InvoiceEvent {
  type: "invoice.invoice_date_elapsed";
  properties: {
    invoice_date: string;
  };
}

interface InvoiceIssuedEvent extends InvoiceEvent {
  type: "invoice.issued";
  properties: {
    automatically_marked_as_paid: boolean;
  };
}

interface InvoiceIssueFailedEvent extends InvoiceEvent {
  type: "invoice.issue_failed";
  properties: {
    reason: string;
  };
}

interface InvoicePaymentFailedEvent extends InvoiceEvent {
  type: "invoice.payment_failed";
  properties: {
    payment_provider: "stripe";
    payment_provider_id: string;
    payment_provider_transaction_id: string | null;
  };
}

interface InvoicePaymentProcessingEvent extends InvoiceEvent {
  type: "invoice.payment_processing";
  properties: {
    payment_provider: "stripe";
    payment_provider_id: string;
  };
}

interface InvoicePaymentSucceededEvent extends InvoiceEvent {
  type: "invoice.payment_succeeded";
  properties: {
    payment_provider: "stripe";
    payment_provider_id: string;
    payment_provider_transaction_id: string;
  };
}

interface InvoiceEditedEvent extends InvoiceEvent {
  type: "invoice.edited";
  properties: {
    previous_attributes: {
      amount_due?: string;
      subtotal?: string;
      total?: string;
      discounts?: Array<Discount>;
      minimum?: Invoice.Minimum;
      line_items?: Array<Invoice.LineItem>;
    };
  };
}

interface InvoiceManuallyMarkedAsVoidEvent extends InvoiceEvent {
  type: "invoice.manually_marked_as_void";
  properties: Record<string, never>;
}

interface InvoiceManuallyMarkedAsPaidEvent extends InvoiceEvent {
  type: "invoice.manually_marked_as_paid";
  properties: {
    payment_received_date: string;
    external_id: string;
    notes: string;
  };
}

interface InvoiceUndoMarkAsPaidEvent extends InvoiceEvent {
  type: "invoice.undo_mark_as_paid";
  properties: Record<string, never>;
}

interface InvoiceSyncSucceededEvent extends InvoiceEvent {
  type: "invoice.sync_succeeded";
  properties: {
    payment_provider: string;
    payment_provider_id: string;
  };
}

interface InvoiceSyncFailedEvent extends InvoiceEvent {
  type: "invoice.sync_failed";
  properties: {
    payment_provider: string;
    payment_provider_id: string;
  };
}

// Credit note events
interface CreditNoteEvent extends BaseWebhookEvent {
  credit_note: CreditNote;
}

interface CreditNoteIssuedEvent extends CreditNoteEvent {
  type: "credit_note.issued";
  properties: Record<string, never>;
}

interface CreditNoteMarkedAsVoidEvent extends CreditNoteEvent {
  type: "credit_note.marked_as_void";
  properties: Record<string, never>;
}

// Usage and balance events
export interface SubscriptionUsageExceededEvent extends SubscriptionEvent {
  type: "subscription.usage_exceeded";
  properties: {
    billable_metric_id: string;
    timeframe_start: string;
    timeframe_end: string;
    quantity_threshold: number;
  };
  alert_configuration: Alert;
}

interface SubscriptionCostExceededEvent extends SubscriptionEvent {
  type: "subscription.cost_exceeded";
  properties: {
    timeframe_start: string;
    timeframe_end: string;
    amount_threshold: number;
  };
}

interface CustomerCreditBalanceEvent extends BaseWebhookEvent {
  type:
    | "customer.credit_balance_depleted"
    | "customer.credit_balance_recovered";
  customer: Customer;
  properties: {
    pricing_unit: {
      name: string;
      symbol: string;
      display_name: string;
    };
  };
}

interface CustomerCreditBalanceDroppedEvent extends BaseWebhookEvent {
  type: "customer.credit_balance_dropped";
  customer: Customer;
  properties: {
    balance_threshold: string;
    pricing_unit: {
      name: string;
      symbol: string;
      display_name: string;
    };
  };
}

// Test event
interface ResourceEventTest extends BaseWebhookEvent {
  type: "resource_event.test";
  message: string;
}

// Union type of all possible webhook events
export type WebhookEvent =
  | CustomerCreatedEvent
  | CustomerEditedEvent
  | SubscriptionCreatedEvent
  | SubscriptionStartedEvent
  | SubscriptionFixedFeeQuantityUpdatedEvent
  | SubscriptionEditedEvent
  | SubscriptionEndedEvent
  | SubscriptionPlanChangedEvent
  | SubscriptionPlanVersionChangeScheduledEvent
  | SubscriptionPlanVersionChangedEvent
  | InvoiceDateElapsedEvent
  | InvoiceIssuedEvent
  | InvoiceIssueFailedEvent
  | InvoicePaymentFailedEvent
  | InvoicePaymentProcessingEvent
  | InvoicePaymentSucceededEvent
  | InvoiceEditedEvent
  | InvoiceManuallyMarkedAsVoidEvent
  | InvoiceManuallyMarkedAsPaidEvent
  | InvoiceUndoMarkAsPaidEvent
  | InvoiceSyncSucceededEvent
  | InvoiceSyncFailedEvent
  | CreditNoteIssuedEvent
  | CreditNoteMarkedAsVoidEvent
  | SubscriptionUsageExceededEvent
  | SubscriptionCostExceededEvent
  | CustomerCreditBalanceEvent
  | CustomerCreditBalanceDroppedEvent
  | ResourceEventTest;
