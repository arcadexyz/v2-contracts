## TODOs

Evan:
- Write installments tests
  - (PARTIAL) Update LoanTerms struct.
    - Change from `collateralTokenId` to `bundleId`.
  - (DONE) Implement interest rate functionality into RepaymentController.sol.
    - (DONE) Change comments for LoanTerms interest.
    - (DONE) Internal calc function.
  - (DONE) Port over (5) RepaymentController functions and (1) LoanCore function.
    - (DONE) Rewrite comments in natspec
  - (DONE) Port over repayPart function to LoanCore.sol
    - (DONE) Update other functions to jive with LoanTerms.
  - (DONE) port over two new test scripts `Installments.ts` and `InstallmentsRepay.ts`.
    - (DONE) Convert AssetWrapper in the tests to new AssetVault implementation.
    🔑 For Installment tests, run `npx hardhat test test/Installments.ts` or `npx hardhat test test/InstallmentsRepay.ts`.

- Review Origination PR
  - loan terms review, then integrate with my functions.

Mouzayan:
- Upgradeability and dependency architecture
    - Decide - which contracts should be upgradeable? What upgradeability pattern should they use?
    - Decide - which dependencies need to get passed in constructors for each contract?
    - Decide - of those dependencies, which should be changeable by an admin? Which should be immutable and/or only changeable by upgrade?
- Review Installments PR and Origination PR

Kevin:
- Write Origination tests
- Review installments PR

Leftover:
- Native rollovers
- Custom errors
- Move compiler to 0.8.11
- Re-do natspec - move to implementation, not interfaces
- Testing with full coverage
