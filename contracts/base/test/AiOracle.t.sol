// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AiOracle} from "../src/AiOracle.sol";
import {Dispute} from "../src/Dispute.sol";
import {IAiOracle, IAiOracleClient} from "../src/IAiOracle.sol";

contract RecordingClient is IAiOracleClient {
    IAiOracle public immutable oracle;
    uint256 public lastId;
    uint8 public lastAnswer;
    uint256 public calls;

    constructor(IAiOracle oracle_) {
        oracle = oracle_;
    }

    function ask(string calldata question) external returns (uint256) {
        return oracle.ask(question);
    }

    function onAnswer(uint256 id, uint8 answer) external {
        lastId = id;
        lastAnswer = answer;
        calls++;
    }
}

contract RevertingClient is IAiOracleClient {
    IAiOracle public immutable oracle;

    constructor(IAiOracle oracle_) {
        oracle = oracle_;
    }

    function ask(string calldata question) external returns (uint256) {
        return oracle.ask(question);
    }

    function onAnswer(uint256, uint8) external pure {
        revert("client failure");
    }
}

contract RejectingReceiver {
    receive() external payable {
        revert("no");
    }
}

contract AiOracleTest is Test {
    AiOracle internal aio;
    Dispute internal dispute;

    address internal owner = makeAddr("owner");
    address internal oracleSigner = makeAddr("oracleSigner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal mallory = makeAddr("mallory");

    string internal constant QUESTION = "Did the shipment arrive before 2026-11-01?";
    uint64 internal constant TIMEOUT = 1 days;

    function setUp() public {
        aio = new AiOracle(oracleSigner, owner, 0);
        dispute = new Dispute(address(aio), TIMEOUT, 0);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function test_constructor_setsRoles() public view {
        assertEq(aio.oracle(), oracleSigner);
        assertEq(aio.owner(), owner);
        assertEq(aio.lastId(), 0);
    }

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(AiOracle.ZeroAddress.selector);
        new AiOracle(address(0), owner, 0);
        vm.expectRevert(AiOracle.ZeroAddress.selector);
        new AiOracle(oracleSigner, address(0), 0);
    }

    function test_setOracle_onlyOwner() public {
        vm.prank(mallory);
        vm.expectRevert(AiOracle.OnlyOwner.selector);
        aio.setOracle(mallory);

        vm.prank(owner);
        aio.setOracle(bob);
        assertEq(aio.oracle(), bob);
    }

    function test_ask_storesKeccakHashAndEmits() public {
        bytes32 expected = keccak256(bytes(QUESTION));

        vm.expectEmit(true, true, false, true, address(aio));
        emit IAiOracle.Asked(1, alice, QUESTION, expected, 0);

        vm.prank(alice);
        uint256 id = aio.ask(QUESTION);

        assertEq(id, 1);
        assertEq(aio.lastId(), 1);
        IAiOracle.Request memory req = aio.getRequest(id);
        assertEq(req.requester, alice);
        assertEq(req.questionHash, expected);
        assertFalse(req.fulfilled);
    }

    function test_ask_incrementsIds() public {
        vm.prank(alice);
        assertEq(aio.ask("a"), 1);
        vm.prank(bob);
        assertEq(aio.ask("b"), 2);
        assertEq(aio.getRequest(2).requester, bob);
        assertEq(aio.getRequest(2).questionHash, keccak256("b"));
    }

    function test_ask_acceptsValue() public {
        vm.prank(alice);
        aio.ask{value: 0.01 ether}(QUESTION);
        assertEq(address(aio).balance, 0.01 ether);
    }

    function test_fulfill_fromNonOracleReverts() public {
        vm.prank(alice);
        uint256 id = aio.ask(QUESTION);

        vm.prank(mallory);
        vm.expectRevert(AiOracle.OnlyOracle.selector);
        aio.fulfill(id, 1, keccak256(bytes(QUESTION)));

        vm.prank(owner);
        vm.expectRevert(AiOracle.OnlyOracle.selector);
        aio.fulfill(id, 1, keccak256(bytes(QUESTION)));
    }

    function test_fulfill_unknownIdReverts() public {
        vm.prank(oracleSigner);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.UnknownRequest.selector, 42));
        aio.fulfill(42, 1, keccak256(bytes(QUESTION)));
    }

    function test_fulfill_wrongHashReverts() public {
        vm.prank(alice);
        uint256 id = aio.ask(QUESTION);
        bytes32 stored = keccak256(bytes(QUESTION));
        bytes32 wrong = keccak256("something else");

        vm.prank(oracleSigner);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.QuestionHashMismatch.selector, stored, wrong));
        aio.fulfill(id, 1, wrong);

        assertFalse(aio.getRequest(id).fulfilled);
    }

    function test_fulfill_invalidAnswerReverts() public {
        vm.prank(alice);
        uint256 id = aio.ask(QUESTION);

        vm.prank(oracleSigner);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.InvalidAnswer.selector, 3));
        aio.fulfill(id, 3, keccak256(bytes(QUESTION)));

        vm.prank(oracleSigner);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.InvalidAnswer.selector, 255));
        aio.fulfill(id, 255, keccak256(bytes(QUESTION)));
    }

    function test_fulfill_replayReverts() public {
        vm.prank(alice);
        uint256 id = aio.ask(QUESTION);
        bytes32 h = keccak256(bytes(QUESTION));

        vm.prank(oracleSigner);
        aio.fulfill(id, 1, h);

        vm.prank(oracleSigner);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.AlreadyFulfilled.selector, id));
        aio.fulfill(id, 2, h);
    }

    function test_fulfill_eoaRequester_emitsAndSkipsCallback() public {
        vm.prank(alice);
        uint256 id = aio.ask(QUESTION);

        vm.expectEmit(true, false, false, true, address(aio));
        emit IAiOracle.Fulfilled(id, 2);

        vm.prank(oracleSigner);
        aio.fulfill(id, 2, keccak256(bytes(QUESTION)));

        assertTrue(aio.getRequest(id).fulfilled);
    }

    function test_fulfill_happyPath_emitsAndCallsBack() public {
        RecordingClient client = new RecordingClient(aio);
        uint256 id = client.ask(QUESTION);
        assertEq(aio.getRequest(id).requester, address(client));

        vm.expectEmit(true, false, false, true, address(aio));
        emit IAiOracle.Fulfilled(id, 1);

        vm.prank(oracleSigner);
        aio.fulfill(id, 1, keccak256(bytes(QUESTION)));

        assertEq(client.calls(), 1);
        assertEq(client.lastId(), id);
        assertEq(client.lastAnswer(), 1);
        assertTrue(aio.getRequest(id).fulfilled);
    }

    function test_fulfill_unknownAnswerIsValid() public {
        RecordingClient client = new RecordingClient(aio);
        uint256 id = client.ask(QUESTION);

        vm.prank(oracleSigner);
        aio.fulfill(id, 0, keccak256(bytes(QUESTION)));

        assertEq(client.lastAnswer(), 0);
        assertTrue(aio.getRequest(id).fulfilled);
    }

    function test_fulfill_callbackRevert_emitsCallbackFailedAndStillFulfills() public {
        RevertingClient client = new RevertingClient(aio);
        uint256 id = client.ask(QUESTION);

        vm.expectEmit(true, false, false, true, address(aio));
        emit IAiOracle.Fulfilled(id, 1);
        vm.expectEmit(true, false, false, true, address(aio));
        emit IAiOracle.CallbackFailed(id);

        vm.prank(oracleSigner);
        aio.fulfill(id, 1, keccak256(bytes(QUESTION)));

        assertTrue(aio.getRequest(id).fulfilled);
    }

    function test_withdraw_onlyOwner() public {
        vm.prank(alice);
        aio.ask{value: 1 ether}(QUESTION);

        vm.prank(mallory);
        vm.expectRevert(AiOracle.OnlyOwner.selector);
        aio.withdraw(payable(mallory));

        uint256 before = bob.balance;
        vm.prank(owner);
        aio.withdraw(payable(bob));
        assertEq(bob.balance - before, 1 ether);
        assertEq(address(aio).balance, 0);
    }

    function test_dispute_open_storesCaseAndAsksOracle() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);

        assertEq(id, 1);
        Dispute.Case memory c = dispute.getCase(id);
        assertEq(c.claimant, alice);
        assertEq(c.counterparty, bob);
        assertEq(c.amount, 1 ether);
        assertFalse(c.settled);
        assertEq(address(dispute).balance, 1 ether);

        IAiOracle.Request memory req = aio.getRequest(id);
        assertEq(req.requester, address(dispute));
        assertEq(req.questionHash, keccak256(bytes(QUESTION)));
    }

    function test_dispute_open_rejectsZeroStakeAndZeroCounterparty() public {
        vm.prank(alice);
        vm.expectRevert(Dispute.NoStake.selector);
        dispute.openDispute(QUESTION, bob, 0);

        vm.prank(alice);
        vm.expectRevert(Dispute.ZeroAddress.selector);
        dispute.openDispute{value: 1 ether}(QUESTION, address(0), 0);
    }

    function test_dispute_yesPaysClaimant() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        vm.expectEmit(true, true, false, true, address(dispute));
        emit Dispute.Settled(id, alice, 1 ether);

        vm.prank(oracleSigner);
        aio.fulfill(id, 1, keccak256(bytes(QUESTION)));

        assertEq(alice.balance - aliceBefore, 1 ether);
        assertEq(bob.balance, bobBefore);
        assertEq(address(dispute).balance, 0);
        assertTrue(dispute.getCase(id).settled);
    }

    function test_dispute_noPaysCounterparty() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        vm.expectEmit(true, true, false, true, address(dispute));
        emit Dispute.Settled(id, bob, 1 ether);

        vm.prank(oracleSigner);
        aio.fulfill(id, 2, keccak256(bytes(QUESTION)));

        assertEq(bob.balance - bobBefore, 1 ether);
        assertEq(alice.balance, aliceBefore);
        assertEq(address(dispute).balance, 0);
        assertTrue(dispute.getCase(id).settled);
    }

    function test_dispute_unknownEscalatesAndKeepsFunds() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        vm.expectEmit(true, false, false, true, address(dispute));
        emit Dispute.Escalated(id);

        vm.prank(oracleSigner);
        aio.fulfill(id, 0, keccak256(bytes(QUESTION)));

        assertEq(alice.balance, aliceBefore);
        assertEq(bob.balance, bobBefore);
        assertEq(address(dispute).balance, 1 ether);
        assertFalse(dispute.getCase(id).settled);
        assertTrue(aio.getRequest(id).fulfilled);
    }

    function test_dispute_onAnswer_onlyOracleContract() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);

        vm.prank(oracleSigner);
        vm.expectRevert(Dispute.OnlyOracle.selector);
        dispute.onAnswer(id, 1);

        vm.prank(mallory);
        vm.expectRevert(Dispute.OnlyOracle.selector);
        dispute.onAnswer(id, 1);
    }

    function test_dispute_payoutFailure_surfacesAsCallbackFailed() public {
        RejectingReceiver rejecting = new RejectingReceiver();
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, address(rejecting), 0);

        vm.expectEmit(true, false, false, true, address(aio));
        emit IAiOracle.CallbackFailed(id);

        vm.prank(oracleSigner);
        aio.fulfill(id, 2, keccak256(bytes(QUESTION)));

        assertEq(address(dispute).balance, 1 ether);
        assertFalse(dispute.getCase(id).settled);
        assertTrue(aio.getRequest(id).fulfilled);
    }

    function test_refund_constructorRejectsZeroTimeout() public {
        vm.expectRevert(Dispute.ZeroTimeout.selector);
        new Dispute(address(aio), 0, 0);
    }

    function test_refund_openStoresDeadline() public {
        vm.warp(1_000_000);
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        Dispute.Case memory c = dispute.getCase(id);
        assertEq(c.deadline, 1_000_000 + TIMEOUT);
        assertFalse(c.escalated);
        assertEq(dispute.timeout(), TIMEOUT);
    }

    function test_refund_unknownAllowsImmediateRefundToClaimant() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        vm.prank(oracleSigner);
        aio.fulfill(id, 0, keccak256(bytes(QUESTION)));
        assertTrue(dispute.getCase(id).escalated);

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        vm.expectEmit(true, true, false, true, address(dispute));
        emit Dispute.Refunded(id, alice, 1 ether);
        vm.prank(mallory);
        dispute.refund(id);

        assertEq(alice.balance - aliceBefore, 1 ether);
        assertEq(bob.balance, bobBefore);
        assertEq(address(dispute).balance, 0);
        assertTrue(dispute.getCase(id).settled);
    }

    function test_refund_noAnswerRevertsBeforeDeadlineThenRefunds() public {
        vm.warp(1_000_000);
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        uint64 deadline = uint64(1_000_000) + TIMEOUT;

        vm.expectRevert(abi.encodeWithSelector(Dispute.TooEarly.selector, id, deadline));
        dispute.refund(id);

        vm.warp(deadline - 1);
        vm.expectRevert(abi.encodeWithSelector(Dispute.TooEarly.selector, id, deadline));
        dispute.refund(id);

        vm.warp(deadline);
        uint256 aliceBefore = alice.balance;
        dispute.refund(id);
        assertEq(alice.balance - aliceBefore, 1 ether);
        assertTrue(dispute.getCase(id).settled);
    }

    function test_refund_twiceReverts() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        vm.prank(oracleSigner);
        aio.fulfill(id, 0, keccak256(bytes(QUESTION)));
        dispute.refund(id);
        vm.expectRevert(abi.encodeWithSelector(Dispute.AlreadySettled.selector, id));
        dispute.refund(id);
    }

    function test_refund_afterYesSettlementReverts() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        vm.prank(oracleSigner);
        aio.fulfill(id, 2, keccak256(bytes(QUESTION)));
        vm.warp(block.timestamp + TIMEOUT);
        vm.expectRevert(abi.encodeWithSelector(Dispute.AlreadySettled.selector, id));
        dispute.refund(id);
        assertEq(address(dispute).balance, 0);
    }

    function test_refund_unknownDisputeReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Dispute.UnknownDispute.selector, 42));
        dispute.refund(42);
    }

    function test_refund_lateAnswerAfterRefundDoesNotPayTwice() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        vm.warp(block.timestamp + TIMEOUT);
        dispute.refund(id);
        uint256 bobBefore = bob.balance;

        vm.expectEmit(true, false, false, true, address(aio));
        emit IAiOracle.CallbackFailed(id);
        vm.prank(oracleSigner);
        aio.fulfill(id, 2, keccak256(bytes(QUESTION)));

        assertEq(bob.balance, bobBefore);
        assertEq(address(dispute).balance, 0);
        assertTrue(aio.getRequest(id).fulfilled);
    }

    function test_refund_lateYesBeforeRefundStillSettles() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        vm.warp(block.timestamp + TIMEOUT + 1);
        uint256 aliceBefore = alice.balance;
        vm.prank(oracleSigner);
        aio.fulfill(id, 1, keccak256(bytes(QUESTION)));
        assertEq(alice.balance - aliceBefore, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(Dispute.AlreadySettled.selector, id));
        dispute.refund(id);
    }

    function test_refund_rescuesStakeAfterFailedPayout() public {
        RejectingReceiver rejecting = new RejectingReceiver();
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, address(rejecting), 0);
        vm.prank(oracleSigner);
        aio.fulfill(id, 2, keccak256(bytes(QUESTION)));
        assertEq(address(dispute).balance, 1 ether);

        vm.expectRevert(abi.encodeWithSelector(Dispute.TooEarly.selector, id, dispute.getCase(id).deadline));
        dispute.refund(id);
        vm.warp(dispute.getCase(id).deadline);
        uint256 aliceBefore = alice.balance;
        dispute.refund(id);
        assertEq(alice.balance - aliceBefore, 1 ether);
        assertEq(address(dispute).balance, 0);
    }

    function test_refund_disputesAreIndependent() public {
        vm.startPrank(alice);
        uint256 a = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        uint256 b = dispute.openDispute{value: 2 ether}(QUESTION, bob, 0);
        vm.stopPrank();
        vm.prank(oracleSigner);
        aio.fulfill(a, 0, keccak256(bytes(QUESTION)));
        dispute.refund(a);
        assertEq(address(dispute).balance, 2 ether);
        vm.expectRevert(abi.encodeWithSelector(Dispute.TooEarly.selector, b, dispute.getCase(b).deadline));
        dispute.refund(b);
    }

    function testFuzz_refund_neverBeforeDeadlineWithoutUnknown(uint64 elapsed) public {
        vm.warp(1_000_000);
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        elapsed = uint64(bound(elapsed, 0, TIMEOUT - 1));
        vm.warp(1_000_000 + uint256(elapsed));
        vm.expectRevert(abi.encodeWithSelector(Dispute.TooEarly.selector, id, uint64(1_000_000) + TIMEOUT));
        dispute.refund(id);
    }

    function testFuzz_ask_hashMatchesKeccak(string calldata q) public {
        vm.prank(alice);
        uint256 id = aio.ask(q);
        assertEq(aio.getRequest(id).questionHash, keccak256(bytes(q)));
    }

    function testFuzz_fulfill_rejectsAnswersAboveTwo(uint8 answer) public {
        answer = uint8(bound(answer, 3, 255));
        vm.prank(alice);
        uint256 id = aio.ask(QUESTION);
        vm.prank(oracleSigner);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.InvalidAnswer.selector, answer));
        aio.fulfill(id, answer, keccak256(bytes(QUESTION)));
    }

    function test_review_keccakOfUkrainianQuestionMatchesCast() public pure {
        string memory q = unicode"Чи об'єднали \"Дніпро\" з Кам'янським у 2024 році?";
        assertEq(bytes(q).length, 80);
        assertEq(keccak256(bytes(q)), 0x25d369988a06be585d634f617697a6071c6d8a720206e5ca0708aa3c4b764594);
        assertEq(keccak256(bytes("hello")), 0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8);
    }

    function test_review_fulfillCalldataMatchesNearEncoding() public pure {
        bytes32 h = keccak256(bytes("Did the Ethereum Dencun upgrade activate on mainnet before April 2024?"));
        bytes memory expected =
            hex"3b3b458b0000000000000000000000000000000000000000000000000000000000000102000000000000000000000000000000000000000000000000000000000000000124f851ebe22469538e91325418375a89b845f25da49545adeab51d3a33bb2ef7";
        assertEq(abi.encodeWithSelector(IAiOracle.fulfill.selector, uint256(258), uint8(1), h), expected);
    }

    function test_review_fulfillUnder150kRevertsInsteadOfStarvingCallback() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        uint256 callGas = 150_000 - 21_000 - 16 * 36 - 4 * 64;
        vm.prank(oracleSigner);
        vm.expectPartialRevert(AiOracle.InsufficientGasForCallback.selector);
        aio.fulfill{gas: callGas}(id, 1, keccak256(bytes(QUESTION)));
        assertFalse(aio.getRequest(id).fulfilled);
        assertFalse(dispute.getCase(id).settled);
    }

    function test_review_fulfillDisputePathGasUnder300kLimit() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 0);
        uint256 callGas = 300_000 - 21_000 - 16 * 36 - 4 * 64;
        vm.prank(oracleSigner);
        uint256 before = gasleft();
        aio.fulfill{gas: callGas}(id, 1, keccak256(bytes(QUESTION)));
        emit log_named_uint("fulfill+dispute callback gas used", before - gasleft());
        assertTrue(dispute.getCase(id).settled);
    }
}
