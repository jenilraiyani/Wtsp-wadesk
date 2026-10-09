import React from 'react';

const Privacy = () => {
  return (
    <div className="card privacy-doc">
      <p className="privacy-updated">Last updated: 22 September 2026</p>

      <div className="privacy-warn">
        <h3>WhatsApp blocking disclaimer</h3>
        <p>
          WaDesk is <strong>not</strong> an official WhatsApp product and does <strong>not</strong> use the official
          WhatsApp Business Platform / Cloud API. Sessions are connected through an <strong>unofficial WhatsApp
          Web protocol</strong> (Baileys). WhatsApp can detect unofficial clients at any time.
        </p>
        <ul>
          <li>Your phone number or WhatsApp account may be <strong>restricted, banned, or logged out</strong> without notice.</li>
          <li>Messages may fail, delay, or be marked as spam by WhatsApp. Delivery is never guaranteed.</li>
          <li>Bulk or unsolicited messaging increases ban risk. Do not use this panel to spam, scrape, or bypass WhatsApp limits.</li>
          <li>WaDesk and its operators are <strong>not responsible</strong> for blocked numbers, lost chats, lost business, or any action WhatsApp takes against your account.</li>
          <li>You use this software at your own risk and you are solely responsible for complying with WhatsApp Terms of Service, Meta policies, and applicable law (including India IT Act / TRAI rules on commercial messages).</li>
        </ul>
        <p>
          By using WaDesk you confirm that you understand this unofficial method can lead to permanent WhatsApp
          account loss, and that you accept full responsibility for every number you connect and every message you send.
        </p>
      </div>

      <h3>Privacy policy</h3>
      <p>
        This policy explains how WaDesk handles information when you use the operations panel. It applies only to this
        application, not to WhatsApp, Meta, or any third-party service.
      </p>

      <h3>Information we store</h3>
      <ul>
        <li><strong>Account data:</strong> name, email, password hash (not the plain password), role, and Google sign-in identifier if used.</li>
        <li><strong>Device data:</strong> device labels, connection status, and session files needed to keep a WhatsApp Web session linked.</li>
        <li><strong>Messaging data:</strong> campaign names, recipient numbers you provide, message text, media metadata, send/fail status, and timestamps.</li>
        <li><strong>Access data:</strong> which operator may use which device.</li>
      </ul>
      <p>
        We do not sell personal data. Message content is stored so operators can run campaigns and review history inside this panel.
      </p>

      <h3>How data is used</h3>
      <ul>
        <li>To authenticate users and assign admin or operator access.</li>
        <li>To keep WhatsApp sessions connected and to send messages you request.</li>
        <li>To show dashboards, history, and send/fail counts.</li>
        <li>To restrict devices so operators only see numbers they are allowed to use.</li>
      </ul>

      <h3>Where data lives</h3>
      <p>
        Application records are stored in the SQL Server database configured by your administrator. WhatsApp session
        credentials are stored on the server that runs WaDesk. Your organisation controls that server, backups, and who
        can log in.
      </p>

      <h3>Sharing</h3>
      <p>
        Message traffic is sent through WhatsApp’s network because you connected a WhatsApp account. WhatsApp / Meta
        process that traffic under their own terms. We do not share your panel login data with third parties for
        advertising. Hosting, database, and IT administrators who operate this server can access stored records.
      </p>

      <h3>Retention and deletion</h3>
      <p>
        Campaign and compose logs remain until an administrator removes them from the database. Removing a device from
        WaDesk deletes that device record from the panel database and drops the local session files; it does not delete
        chats that already exist inside WhatsApp.
      </p>

      <h3>Your responsibilities</h3>
      <ul>
        <li>Send only to people who have consented to receive messages.</li>
        <li>Do not upload contact lists you are not authorised to use.</li>
        <li>Keep login credentials private and sign out on shared computers.</li>
        <li>Treat unofficial API use as high risk for the connected WhatsApp numbers.</li>
      </ul>

      <h3>Contact</h3>
      <p>
        For access, correction, or deletion of panel data, contact your WaDesk administrator. This page is a product
        notice, not legal advice.
      </p>
    </div>
  );
};

export default Privacy;
