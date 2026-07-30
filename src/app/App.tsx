import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { HomePage } from './pages/Home';
import { MenuPage } from './pages/Menu';
import { ReservationPage } from './pages/Reservation';
import { EventsPage } from './pages/Events';
import { MembershipPage } from './pages/Membership';
import { AdminPage } from './pages/admin/AdminPage';
import { TrackPage } from './pages/Track';
import { DineInOrderPage } from './pages/DineInOrder';
import { FeedbackPage } from './pages/Feedback';
import ReservationTicketPage from './pages/ReservationTicket';
import CheckinScanner from './pages/admin/CheckinScanner';
import SignIn from './pages/SignIn';
import Account from './pages/Account';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster />
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="menu" element={<MenuPage />} />
            <Route path="reserve" element={<ReservationPage />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="membership" element={<MembershipPage />} />
            <Route path="signin" element={<SignIn />} />
            <Route path="account" element={<Account />} />
          </Route>
          <Route path="/track" element={<TrackPage />} />
          <Route path="/r/:token" element={<ReservationTicketPage />} />
          <Route path="/order" element={<DineInOrderPage />} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/checkin" element={<CheckinScanner />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;