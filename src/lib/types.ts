export type Role = "owner" | "staff" | "client";

export type Staff = {
  id: string;
  full_name: string;
  color: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  bookable_online: boolean;
  sort_order: number;
  profile_id: string | null;
};

export type WorkingHours = { staff_id: string; weekday: number; start_time: string; end_time: string };

export type ScheduleDay = {
  id: string;
  staff_id: string;
  day: string;
  is_day_off: boolean;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
};

export type Category = { id: string; name: string; parent_id: string | null; sort_order: number };

export type Service = {
  id: string;
  name: string;
  category_id: string | null;
  duration_minutes: number;
  price: number;
  package_sessions: number;
  active: boolean;
  sort_order: number;
};

export type Room = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  sort_order: number;
  open_time: string;
  close_time: string;
};

export type Label = { id: string; name: string; color: string };
export type PaymentMethod = { code: string; name: string; counts_to_revenue: boolean; is_cash: boolean };

export type ClientLite = {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
};

export type AppointmentStatus = "booked" | "confirmed" | "completed" | "cancelled" | "no_show";

export type Appointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  staff_id: string;
  room_id: string | null;
  staff_note: string | null;
  client_note: string | null;
  price: number | null;
  deposit_amount: number | null;
  deposit_method: string | null;
  source: string;
  client: ClientLite | null;
  appointment_services: {
    service_id: string;
    duration_minutes: number;
    price: number;
    position: number;
    client_package_id: string | null;
    service: { name: string } | null;
  }[];
  appointment_labels: { label_id: string }[];
};

export type DayNote = { id: string; day: string; staff_id: string | null; text: string };

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  booked: "umówiona",
  confirmed: "potwierdzona",
  completed: "sfinalizowana",
  cancelled: "odwołana",
  no_show: "nie przyszła",
};

export const APPOINTMENT_SELECT = `
  id, starts_at, ends_at, status, staff_id, room_id, staff_note, client_note, price,
  deposit_amount, deposit_method, source,
  client:clients(id, first_name, last_name, phone, email),
  appointment_services(service_id, duration_minutes, price, position, client_package_id, service:services(name)),
  appointment_labels(label_id)
`;

export const clientName = (c: { first_name: string; last_name: string | null } | null | undefined) =>
  c ? [c.first_name, c.last_name].filter(Boolean).join(" ") : "—";

/** wyszukiwanie bez polskich znaków i wielkości liter */
export const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");
