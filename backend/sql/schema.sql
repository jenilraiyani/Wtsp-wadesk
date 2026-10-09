USE WhatsAppPanel;
GO

IF OBJECT_ID('dbo.CampaignLogs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CampaignLogs (
        Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        CampaignId NVARCHAR(40) NOT NULL,
        PhoneNumber NVARCHAR(20) NOT NULL,
        Status NVARCHAR(20) NOT NULL,
        ErrorMessage NVARCHAR(800) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CampaignLogs_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID('dbo.Campaigns', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Campaigns (
        Id NVARCHAR(40) NOT NULL PRIMARY KEY,
        Name NVARCHAR(200) NOT NULL,
        UserId NVARCHAR(40) NULL,
        DeviceId NVARCHAR(40) NULL,
        Message NVARCHAR(MAX) NULL,
        Status NVARCHAR(30) NOT NULL CONSTRAINT DF_Campaigns_Status DEFAULT 'draft',
        TotalCount INT NOT NULL CONSTRAINT DF_Campaigns_Total DEFAULT 0,
        SentCount INT NOT NULL CONSTRAINT DF_Campaigns_Sent DEFAULT 0,
        FailedCount INT NOT NULL CONSTRAINT DF_Campaigns_Failed DEFAULT 0,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Campaigns_CreatedAt DEFAULT SYSUTCDATETIME(),
        CompletedAt DATETIME2 NULL
    );
END
GO

IF OBJECT_ID('dbo.UserDevices', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserDevices (
        UserId NVARCHAR(40) NOT NULL,
        DeviceId NVARCHAR(40) NOT NULL,
        CONSTRAINT PK_UserDevices PRIMARY KEY (UserId, DeviceId)
    );
END
GO

IF OBJECT_ID('dbo.Devices', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Devices (
        Id NVARCHAR(40) NOT NULL PRIMARY KEY,
        Label NVARCHAR(120) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Devices_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Devices_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        Id NVARCHAR(40) NOT NULL PRIMARY KEY,
        Username NVARCHAR(80) NOT NULL UNIQUE,
        Email NVARCHAR(180) NULL,
        GoogleId NVARCHAR(80) NULL,
        AuthProvider NVARCHAR(20) NOT NULL CONSTRAINT DF_Users_AuthProvider DEFAULT 'local',
        Name NVARCHAR(120) NOT NULL,
        PasswordHash NVARCHAR(200) NOT NULL,
        Role NVARCHAR(20) NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_UserDevices_Users')
    ALTER TABLE dbo.UserDevices ADD CONSTRAINT FK_UserDevices_Users
        FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_UserDevices_Devices')
    ALTER TABLE dbo.UserDevices ADD CONSTRAINT FK_UserDevices_Devices
        FOREIGN KEY (DeviceId) REFERENCES dbo.Devices(Id) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CampaignLogs_Campaigns')
    ALTER TABLE dbo.CampaignLogs ADD CONSTRAINT FK_CampaignLogs_Campaigns
        FOREIGN KEY (CampaignId) REFERENCES dbo.Campaigns(Id) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CampaignLogs_CampaignId')
    CREATE INDEX IX_CampaignLogs_CampaignId ON dbo.CampaignLogs (CampaignId, CreatedAt DESC);
GO
